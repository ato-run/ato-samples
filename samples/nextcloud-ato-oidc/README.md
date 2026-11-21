# Nextcloud signed in with Ato (OpenID Connect)

Nextcloud 31 on a self-hosted Ato. People open it from the Ato Library and are
signed in with their Ato account: no Nextcloud password, no Nextcloud login
form. Each person gets their own Nextcloud account (`preferred_username` from
the Instance's account mapping); removing someone from the app ends their
existing session on the next request.

## How it fits together

- Ato's self-hosted Coordinator is the OpenID Provider
  (`<origin>/v1/selfhost/oidc`).
- The `oidc_issuer` Binding (`ato.oidc-issuer@1`) gives the Nextcloud service
  a Runner-owned relay to the provider's discovery, JWKS, token and userinfo
  endpoints (`ATO_BINDING_OIDC_ISSUER`). The browser still uses the public
  authorize endpoint.
- `oidc_client_id`, `oidc_client_secret` and `nextcloud_admin_password` are
  secret Bindings given at import.
- `start.sh` installs Nextcloud on first start (SQLite, no sample files for
  new accounts) and, on every start, configures user_oidc with
  `allow_multiple_user_backends = 0`, so the login page goes straight to Ato.
- The code is read-only image content. The Instance's single state directory
  `/var/lib/nextcloud` holds `config/` (`NEXTCLOUD_CONFIG_DIR`) and `data/`, so
  a checkpoint (and therefore an in-place update) carries only the data.

## Build the image

The Runner runs workloads read-only, without capabilities and without root,
and refuses images that declare `VOLUME`:

```sh
docker build -t nextcloud-ato:31 image
# Re-import without VOLUME, as www-data (keep ENV and WORKDIR).
```

Replace the `oci.image` digest in `capsule.toml` with your image's.

## Install

1. Choose a client id and a secret of at least 32 characters.
2. Import the bundle with the three secret Bindings.
3. `set-app-oidc <INSTANCE_ID> --client-id <id> --auto email_local < secret`.
4. Add members (`add-app-member`) or share the app with an organization.

The Runner must have network controls on (`ATO_RUNTIME_NETWORK_CONTROLS=true`
with the distribution's egress firewall units); it then advertises
`network=ato.oidc-issuer@1`.

## Limitations

- `NEXTCLOUD_TRUSTED_DOMAINS` names this installation's app domain and Runner
  host; set them for yours.
- The image replaces the release's license symlinks with copies, because Ato's
  state checkpoints carry only regular files and directories.
- A state checkpoint is limited to 64 MiB. An Instance whose files grow past
  that cannot be updated in place yet.
- The code directory is read-only, so Nextcloud cannot write its `.htaccess`
  rewrite rules; URLs keep `/index.php/`.
