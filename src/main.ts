'use strict';

import * as core from '@actions/core';
import { validate as uuidValidate } from 'uuid';

type Input = {
  connectionId: string;
  expiresIn: number;
};

type ResponseBody = {
  access_token: string;
};

type ErrorBody = {
  message: string;
};

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const input = getInput();
    const idToken = await core.getIDToken('api.docker.com');

    const resp = await fetch('https://hub.docker.com/v2/auth/oidc/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `github.com/docker/oidc-action` // TODO: Add version
      },
      body: JSON.stringify({
        connection_id: input.connectionId,
        token: idToken
      })
    });

    if (!resp.ok) {
      const errBody = (await resp.json()) as ErrorBody;

      core.setFailed(
        `oidc token request failed with a status of ${resp.status}: ${errBody.message}`
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
