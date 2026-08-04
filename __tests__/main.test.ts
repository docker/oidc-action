/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * To mock dependencies in ESM, you can create fixtures that export mock
 * functions and objects. For example, the core module is mocked in this test,
 * so that the actual '@actions/core' module is not imported.
 */
import { jest } from '@jest/globals';
import * as core from '../__fixtures__/core.js';
import { v4 as uuidv4 } from 'uuid';
import nock from 'nock';

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core);

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js');

/**
 * Mocks core.getInput for the given inputs. By default the canonical
 * kebab-case inputs are populated with valid values. Overrides are merged in
 * and may set snake_case aliases or clear an input by passing an empty string.
 *
 * Unset inputs resolve to '', matching the real behavior of @actions/core.
 */
function mockInput(overrides: { [key: string]: string } = {}) {
  const values: { [key: string]: string } = {
    'connection-id': uuidv4(),
    'expires-in': '300',
    ...overrides
  };

  core.getInput.mockImplementation((name) => values[name] ?? '');
}

/**
 * Intercepts the token exchange request, capturing the parsed form body so
 * tests can assert on the values that were actually sent.
 */
function mockTokenExchange(
  status: number,
  body: object,
  headers?: Record<string, string>
): { body: Record<string, string> } {
  const captured = { body: {} as Record<string, string> };
  nock('https://identity.docker.com')
    .post('/oauth/token', (b: Record<string, string>) => {
      captured.body = b;
      return true;
    })
    .reply(status, body, headers);
  return captured;
}

describe('main.ts', () => {
  beforeAll(() => {
    core.getIDToken.mockResolvedValue('id_token');
  });

  afterEach(() => {
    jest.resetAllMocks();
    nock.cleanAll();
  });

  it('Errors when no connection id is provided', async () => {
    mockInput({ 'connection-id': '' });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith('connection-id is required.');
  });

  it('Errors for an invalid connection-id', async () => {
    mockInput({ 'connection-id': 'invalid' });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      'Invalid connection-id. Must be a v4 UUID.'
    );
  });

  it('Errors for an invalid expires-in', async () => {
    for (const value of ['invalid', '21601', '299']) {
      mockInput({ 'expires-in': value });
      await run();
      expect(core.setFailed).toHaveBeenCalledWith(
        `Invalid expires-in: ${value}. Must be between 300 and 21600`
      );
    }
  });

  it('Errors for a non-200 response', async () => {
    mockInput();
    mockTokenExchange(500, {
      error: 'server_error',
      error_description: 'oh no!'
    });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      'oidc token request failed with a status of 500: {"error":"server_error","error_description":"oh no!"}'
    );
  });

  it('Retries on a 429 response honoring Retry-After', async () => {
    mockInput();
    mockTokenExchange(
      429,
      { description: 'slow down' },
      { 'Retry-After': '0' }
    );
    mockTokenExchange(200, { access_token: 'test_access_token' });
    await run();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenNthCalledWith(
      1,
      'token',
      'test_access_token'
    );
  });

  it('Fails after exhausting retries on repeated 429s', async () => {
    mockInput();
    nock('https://identity.docker.com')
      .post('/oauth/token')
      .times(6)
      .reply(
        429,
        { error: 'rate_limited', error_description: 'slow down' },
        { 'Retry-After': '0' }
      );
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      'oidc token request failed with a status of 429: {"error":"rate_limited","error_description":"slow down"}'
    );
  });

  it('Succeeds using the kebab-case inputs', async () => {
    const connectionId = uuidv4();
    mockInput({ 'connection-id': connectionId, 'expires-in': '600' });
    const req = mockTokenExchange(200, { access_token: 'test_access_token' });
    await run();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(req.body.connection_id).toBe(connectionId);
    expect(req.body.expires_in).toBe('600');
    expect(core.setSecret).toHaveBeenNthCalledWith(1, 'test_access_token');
    expect(core.setOutput).toHaveBeenNthCalledWith(
      1,
      'token',
      'test_access_token'
    );
  });

  it('Falls back to the deprecated snake_case inputs', async () => {
    const connectionId = uuidv4();
    mockInput({
      'connection-id': '',
      'expires-in': '',
      connection_id: connectionId,
      expires_in: '600'
    });
    const req = mockTokenExchange(200, { access_token: 'test_access_token' });
    await run();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(req.body.connection_id).toBe(connectionId);
    expect(req.body.expires_in).toBe('600');
  });

  it('Prefers kebab-case over deprecated snake_case when both are set', async () => {
    const kebab = uuidv4();
    const snake = uuidv4();
    mockInput({
      'connection-id': kebab,
      'expires-in': '600',
      connection_id: snake,
      expires_in: '900'
    });
    const req = mockTokenExchange(200, { access_token: 'test_access_token' });
    await run();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(req.body.connection_id).toBe(kebab);
    expect(req.body.expires_in).toBe('600');
  });

  it('Defaults expires-in to 300 when unset', async () => {
    mockInput({ 'expires-in': '' });
    const req = mockTokenExchange(200, { access_token: 'test_access_token' });
    await run();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(req.body.expires_in).toBe('300');
  });
});
