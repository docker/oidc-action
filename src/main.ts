'use strict';

import * as core from '@actions/core';
import { validate as uuidValidate } from 'uuid';

const audience = 'https://identity.docker.com';
const url = 'https://identity.docker.com/oauth/token';

type Input = {
  connectionId: string;
  expiresIn: number;
};

type ResponseBody = {
  access_token: string;
};

type ErrorBody = {
  error: string;
  error_description?: string;
  error_uri?: string;
};

const maxRetries = 5;

/**
 * Parses a Retry-After header value into a delay in milliseconds. The header
 * is a number of seconds.
 *
 * @param value The Retry-After header value, or null if absent.
 * @returns The delay in milliseconds, or null if the value is missing/invalid.
 */
function parseRetryAfter(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const seconds = Number(value);
  if (isNaN(seconds)) {
    return null;
  }

  return Math.max(0, seconds * 1000);
}

/**
 * Performs a fetch, retrying up to maxRetries times on a 429 response while
 * honoring the Retry-After header.
 *
 * @param url The URL to request.
 * @param init The fetch request options.
 * @returns The final response.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  let resp = await fetch(url, init);

  for (
    let attempt = 0;
    resp.status === 429 && attempt < maxRetries;
    attempt++
  ) {
    const delay = parseRetryAfter(resp.headers.get('retry-after'));
    if (delay === null) {
      break;
    }

    core.info(
      `oidc token request rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
    );
    await new Promise((resolve) => setTimeout(resolve, delay));

    resp = await fetch(url, init);
  }

  return resp;
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const input = getInput();
    const idToken = await core.getIDToken(audience);

    const data = new URLSearchParams();
    data.set('grant_type', 'urn:ietf:params:oauth:grant-type:token-exchange');
    data.set('subject_token_type', 'urn:ietf:params:oauth:token-type:id_token');
    data.set('subject_token', idToken);
    data.set('connection_id', input.connectionId);
    data.set('expires_in', input.expiresIn.toString());

    const resp = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'github.com/docker/oidc-action' // TODO: Add version
      },
      body: data
    });

    if (!resp.ok) {
      const errBody = (await resp.json()) as ErrorBody;

      core.setFailed(
        `oidc token request failed with a status of ${resp.status}: ${JSON.stringify(errBody)}`
      );

      return;
    }

    const body = (await resp.json()) as ResponseBody;

    core.setSecret(body.access_token); // redacted in workflow logs
    core.setOutput('token', body.access_token);
  } catch (e) {
    if (e instanceof Error) {
      core.setFailed(e.message);

      return;
    }

    throw e;
  }
}

/**
 * Parses, validates, and returns inputs.
 *
 * @returns Input
 */
function getInput(): Input {
  const connectionId = core.getInput('connection_id');
  const expiresInInput = core.getInput('expires_in');

  if (!uuidValidate(connectionId)) {
    throw new Error('Invalid connection_id. Must be a v4 UUID.');
  }

  const expiresIn = Number(expiresInInput);
  if (isNaN(expiresIn) || expiresIn < 300 || expiresIn > 3600) {
    throw new Error(
      `Invalid expires_in: ${expiresInInput}. Must be between 300 and 3600`
    );
  }

  return {
    connectionId,
    expiresIn
  };
}
