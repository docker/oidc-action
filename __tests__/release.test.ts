import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/release.yaml', 'utf8'));
const versionScript: string = workflow.jobs.release.steps.find(
  (step: { name: string }) => step.name === 'Read release version'
).run;
const publishScript: string = workflow.jobs.release.steps.find(
  (step: { name: string }) => step.name === 'Publish release'
).run;

describe('release publishing', () => {
  let directory: string;
  let repository: string;
  let remote: string;
  let env: NodeJS.ProcessEnv;

  function git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: repository,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  }

  function publish(overrides: NodeJS.ProcessEnv = {}) {
    return spawnSync(
      'bash',
      [
        '-e',
        '-o',
        'pipefail',
        '-c',
        `git checkout --detach "$GITHUB_SHA"
${versionScript}
source "$GITHUB_ENV"
${publishScript}`
      ],
      {
        cwd: repository,
        env: { ...env, ...overrides },
        encoding: 'utf8'
      }
    );
  }

  function commitVersion(version: string, lockVersion = version) {
    const pkg = { name: 'release-test', version, private: true };
    writeFileSync(join(repository, 'package.json'), JSON.stringify(pkg));
    writeFileSync(
      join(repository, 'package-lock.json'),
      JSON.stringify({
        ...pkg,
        version: lockVersion,
        lockfileVersion: 3,
        packages: { '': pkg }
      })
    );
    git('add', 'package.json', 'package-lock.json');
    git('commit', '-m', `Set package version to ${version}`);
    env.GITHUB_SHA = git('rev-parse', 'HEAD');
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'oidc-release-'));
    repository = join(directory, 'repository');
    remote = join(directory, 'remote.git');
    const bin = join(directory, 'bin');
    mkdirSync(repository);
    mkdirSync(bin);
    env = {
      PATH: `${bin}:${process.env.PATH}`,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Release Test',
      GIT_AUTHOR_EMAIL: 'release-test@example.com',
      GIT_COMMITTER_NAME: 'Release Test',
      GIT_COMMITTER_EMAIL: 'release-test@example.com',
      GITHUB_ENV: join(directory, 'github-env'),
      RELEASE_STATE: join(directory, 'release-created')
    };
    writeFileSync(
      join(bin, 'gh'),
      `#!/bin/bash
set -e
case "$1 $2" in
  'release view')
    test -f "$RELEASE_STATE"
    echo false
    ;;
  'release create')
    if [[ "$FAIL_RELEASE_CREATION" == 1 ]]; then
      echo 'Simulated release creation failure' >&2
      exit 1
    fi
    touch "$RELEASE_STATE"
    ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o755 }
    );
    git('init', '--bare', remote);
    git('init', '--initial-branch=main');
    commitVersion('1.2.0');
    git('tag', 'v1.2.0');
    git('tag', 'v1');
    git('remote', 'add', 'origin', remote);
    commitVersion('1.3.0');
    git('push', 'origin', 'main', '--tags');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('publishes the committed package version without changing files or main', () => {
    const result = publish();

    expect(result.status).toBe(0);
    expect(git('rev-parse', 'HEAD')).toBe(env.GITHUB_SHA);
    expect(git('status', '--porcelain')).toBe('');
    expect(git('--git-dir', remote, 'rev-parse', 'refs/heads/main')).toBe(
      env.GITHUB_SHA
    );
    expect(git('--git-dir', remote, 'rev-parse', 'v1.3.0^{commit}')).toBe(
      env.GITHUB_SHA
    );
    expect(git('--git-dir', remote, 'rev-parse', 'v1^{commit}')).toBe(
      env.GITHUB_SHA
    );
    expect(existsSync(env.RELEASE_STATE!)).toBe(true);
  });

  it.each(['v1.3.0', '1.03.0', '1.3.0; echo injected'])(
    'rejects an invalid package version %s',
    (version) => {
      commitVersion(version);

      const result = publish();

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('AssertionError');
      expect(git('ls-remote', '--tags', 'origin', 'refs/tags/v1.3.0')).toBe('');
      expect(existsSync(env.RELEASE_STATE!)).toBe(false);
    }
  );

  it('rejects mismatched package and lockfile versions', () => {
    commitVersion('1.3.0', '1.2.0');

    const result = publish();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('package-lock.json version must match');
    expect(git('ls-remote', '--tags', 'origin', 'refs/tags/v1.3.0')).toBe('');
    expect(existsSync(env.RELEASE_STATE!)).toBe(false);
  });

  it('rejects a version tag belonging to a different release', () => {
    git('tag', 'v1.3.0', 'v1.2.0');
    git('push', 'origin', 'refs/tags/v1.3.0');

    const result = publish();

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(
      'v1.3.0 already points to a different commit'
    );
    expect(git('--git-dir', remote, 'rev-parse', 'v1.3.0^{commit}')).toBe(
      git('rev-parse', 'v1.2.0^{commit}')
    );
    expect(git('--git-dir', remote, 'rev-parse', 'refs/heads/main')).toBe(
      env.GITHUB_SHA
    );
    expect(existsSync(env.RELEASE_STATE!)).toBe(false);
  });

  it('rejects a concurrent update without changing either remote tag', () => {
    git('commit', '--allow-empty', '-m', 'Concurrent release');
    const newerCommit = git('rev-parse', 'HEAD');
    git('push', '--force', 'origin', 'HEAD:refs/tags/v1');
    const result = publish();

    expect(result.status).not.toBe(0);
    expect(git('--git-dir', remote, 'rev-parse', 'v1^{commit}')).toBe(
      newerCommit
    );
    expect(git('ls-remote', '--tags', 'origin', 'refs/tags/v1.3.0')).toBe('');
    expect(git('--git-dir', remote, 'rev-parse', 'refs/heads/main')).toBe(
      env.GITHUB_SHA
    );
    expect(existsSync(env.RELEASE_STATE!)).toBe(false);
  });

  it('publishes the selected commit while preserving a newer main tip', () => {
    git('commit', '--allow-empty', '-m', 'Concurrent main update');
    const newerCommit = git('rev-parse', 'HEAD');
    git('push', 'origin', 'main');

    const result = publish();

    expect(result.status).toBe(0);
    expect(git('--git-dir', remote, 'rev-parse', 'refs/heads/main')).toBe(
      newerCommit
    );
    expect(git('--git-dir', remote, 'rev-parse', 'v1^{commit}')).toBe(
      env.GITHUB_SHA
    );
    expect(git('--git-dir', remote, 'rev-parse', 'v1.3.0^{commit}')).toBe(
      env.GITHUB_SHA
    );
  });

  it('retries after main advances without moving the version tag or main', () => {
    const failed = publish({
      FAIL_RELEASE_CREATION: '1',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'
    });

    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('Simulated release creation failure');
    const originalTag = git('--git-dir', remote, 'rev-parse', 'v1.3.0');
    const releaseCommit = git('rev-parse', 'HEAD');
    expect(git('--git-dir', remote, 'rev-parse', 'v1.3.0^{commit}')).toBe(
      releaseCommit
    );
    expect(existsSync(env.RELEASE_STATE!)).toBe(false);

    git('commit', '--allow-empty', '-m', 'Merged after release');
    const newerMain = git('rev-parse', 'HEAD');
    git('push', 'origin', 'HEAD:refs/heads/main');
    const retryRepository = join(directory, 'retry');
    git('clone', remote, retryRepository);
    repository = retryRepository;
    const retried = publish({ GIT_COMMITTER_DATE: '2026-01-02T00:00:00Z' });

    expect(retried.status).toBe(0);
    expect(git('--git-dir', remote, 'rev-parse', 'v1.3.0')).toBe(originalTag);
    expect(git('--git-dir', remote, 'rev-parse', 'refs/heads/main')).toBe(
      newerMain
    );
    expect(git('--git-dir', remote, 'rev-parse', 'v1^{commit}')).toBe(
      releaseCommit
    );
    expect(existsSync(env.RELEASE_STATE!)).toBe(true);
  });
});
