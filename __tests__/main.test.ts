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

let apiMock: nock.Interceptor;

function mockInput(opts?: { name: string; value: string }) {
  const values: { [key: string]: string } = {
    connection_id: uuidv4(),
    expires_in: '300'
  };

  if (opts !== undefined) {
    values[opts.name] = opts.value;
  }

  core.getInput.mockImplementation((name) => {
    return values[name];
  });
}

describe('main.ts', () => {
  beforeAll(() => {
    apiMock = nock('https://identity.docker.com').post('/oauth/token');

    core.getIDToken.mockResolvedValue('id_token');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('Errors for an invalid connection_id', async () => {
    mockInput({ name: 'connection_id', value: 'invalid' });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      'Invalid connection_id. Must be a v4 UUID.'
    );
  });

  it('Errors for an invalid expires_in', async () => {
    mockInput({ name: 'expires_in', value: 'invalid' });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      'Invalid expires_in: invalid. Must be between 300 and 3600'
    );

    mockInput({ name: 'expires_in', value: '3601' });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      'Invalid expires_in: 3601. Must be between 300 and 3600'
    );

    mockInput({ name: 'expires_in', value: '299' });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      'Invalid expires_in: 299. Must be between 300 and 3600'
    );
  });

  it('Errors for a non-200 response', async () => {
    mockInput();
    apiMock.reply(500, { description: 'oh no!' });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      'oidc token request failed with a status of 500: oh no!'
    );
  });

  it('Retries on a 429 response honoring Retry-After', async () => {
    mockInput();
    apiMock.reply(429, { description: 'slow down' }, { 'Retry-After': '0' });
    nock('https://identity.docker.com')
      .post('/oauth/token')
      .reply(200, { access_token: 'test_access_token' });
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
      .reply(429, { description: 'slow down' }, { 'Retry-After': '0' });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      'oidc token request failed with a status of 429: slow down'
    );
  });

  it('Succeeds for a 200 response', async () => {
    apiMock.reply(200, { access_token: 'test_access_token' });
    mockInput();
    await run();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setSecret).toHaveBeenNthCalledWith(1, 'test_access_token');
    expect(core.setOutput).toHaveBeenNthCalledWith(
      1,
      'token',
      'test_access_token'
    );
  });
});
