# Docker OIDC Action

[![GitHub Super-Linter](https://github.com/docker/oidc-action/actions/workflows/linter.yaml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/docker/oidc-action/actions/workflows/ci.yaml/badge.svg)
[![Check dist/](https://github.com/docker/oidc-action/actions/workflows/check-dist.yaml/badge.svg)](https://github.com/docker/oidc-action/actions/workflows/check-dist.yaml)
[![CodeQL](https://github.com/docker/oidc-action/actions/workflows/codeql.yaml/badge.svg)](https://github.com/docker/oidc-action/actions/workflows/codeql.yaml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

The official GitHub Action for authenticating to Docker with OIDC.

It exchanges the GitHub-issued OIDC token for your workflow for a short-lived
Docker access token — so you can log in to Docker Hub without storing a
long-lived password or personal access token as a secret.

**Note:** The returned token's scope is currently limited to registry login (for
example, with `docker/login-action`). Broader use, such as authenticating to the
Docker Hub API, is not supported yet.

## Prerequisites

Create an OIDC connection in your Docker organization and note its connection
ID. Follow the steps in the
[Docker documentation](https://docs.docker.com/enterprise/security/oidc-connections/).

## Usage

The action requires `id-token: write` permission so the workflow can request a
GitHub OIDC token. The exchanged Docker token is returned as the `token` output
and is masked in workflow logs by default.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write # required to request the GitHub OIDC token
    steps:
      - name: Get Docker token
        id: docker_oidc
        uses: docker/oidc-action@v1
        with:
          connection-id: <my-connection-id>

      - name: Log in to Docker Hub
        uses: docker/login-action@v4
        with:
          username: <my-org-name>
          password: ${{ steps.docker_oidc.outputs.token }}
```

## Passing a token between jobs

GitHub skips job outputs containing masked secrets. To pass the token to another
job or reusable workflow, set `mask-token: 'false'` in the producing job, see
the example below:

```yaml
jobs:
  docker-token:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    outputs:
      token: ${{ steps.oidc.outputs.token }}
    steps:
      - name: Get Docker token
        id: oidc
        uses: docker/oidc-action@v1
        with:
          connection-id: ${{ vars.DOCKERHUB_OIDC_CONNECTIONID }}
          mask-token: 'false'

  publish:
    needs: docker-token
    uses: ./.github/workflows/publish.yaml
    secrets:
      registry-password: ${{ needs.docker-token.outputs.token }}
```

Disabling masking removes automatic log redaction of the Docker token in the
producing job. Avoid printing it and mask it in any receiving job before use.

When you control the consuming job, prefer requesting a fresh token there and
keep masking enabled.

## Inputs

| Input           | Required | Default | Description                                                                                             |
| --------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `connection-id` | Yes      | —       | The OIDC connection ID from your Docker organization. Must be a v4 UUID.                                |
| `expires-in`    | No       | `300`   | Lifetime of the returned token, in seconds. Must be between `300` (5 min) and `21600` (6 hours).        |
| `mask-token`    | No       | `true`  | Mask the returned Docker token in workflow logs. Set to `false` to allow forwarding it as a job output. |

## Outputs

| Output  | Description                                                                     |
| ------- | ------------------------------------------------------------------------------- |
| `token` | The short-lived Docker access token. Use it as the password for registry login. |

## License

Distributed under the terms of the [Apache 2.0 License](./LICENSE).
