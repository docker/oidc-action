# Docker OIDC Action

[![GitHub Super-Linter](https://github.com/docker/oidc-action/actions/workflows/linter.yaml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/docker/oidc-action/actions/workflows/ci.yaml/badge.svg)
[![Check dist/](https://github.com/docker/oidc-action/actions/workflows/check-dist.yaml/badge.svg)](https://github.com/docker/oidc-action/actions/workflows/check-dist.yaml)
[![CodeQL](https://github.com/docker/oidc-action/actions/workflows/codeql.yaml/badge.svg)](https://github.com/docker/oidc-action/actions/workflows/codeql.yaml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

This is the official action for OIDC integration with Docker Hub.

## Example Usage

### CLI login

```yaml
steps:
  - name: OIDC token
    id: docker_oidc
    uses: docker/oidc-action@v0
    with:
      connection_id: 867f9d74-789a-4828-a856-12d46bfbbbe7

  - name: Docker login
    uses: docker/login-action@4907a6ddec9925e35a0a9e82d7399ccc52663121 # v4.1.0
    with:
      username: myorgname
      password: ${{ steps.docker_oidc.outputs.token }}
```
