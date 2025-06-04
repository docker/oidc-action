# Docker OIDC Action

[![GitHub Super-Linter](https://github.com/docker/oidc-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/docker/oidc-action/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/docker/oidc-action/actions/workflows/check-dist.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/docker/oidc-action/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

This is the official action for OIDC integration with Docker Hub.

## Example Usage

### CLI login
```yaml
steps:
  - name: OIDC token
    id: docker_oidc
    uses: docker/oidc-action@v1
    with:
      connection_id: 867f9d74-789a-4828-a856-12d46bfbbbe7

  - name: Docker login
    uses: docker/login-action@v3
    with:
      username: myorgname
      password: ${{ steps.docker_oidc.outputs.token }}
```
