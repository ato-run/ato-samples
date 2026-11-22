<?php
/**
 * Merge the Ato bindings into EspoCRM's data/config.php.
 *
 * EspoCRM's installer writes data/config.php and the application keeps its
 * settings there, so start.sh can re-apply the database credentials, the public
 * site URL and the OIDC settings on every start by rewriting the same file the
 * installer and the admin UI write. The file is the only place EspoCRM reads
 * these values from; nothing is kept outside the state directory.
 *
 * Modes:
 *   base  database credentials and siteUrl only. Used after the installation
 *         and before the admin API calls, so they see the current password.
 *   oidc  base, plus the OpenID Connect settings, the default role/team for
 *         accounts created at first sign-in, and the administrator's standard
 *         login.
 *
 * The settings names and the exact files/values the release reads are listed
 * in README.md's "未検証" section; they were taken from the EspoCRM release's
 * OIDC support and must be checked against the source in the VM phase.
 */
declare(strict_types=1);

$file = getenv('ESPO_CONFIG_FILE') ?: '';
if ($file === '' || !is_file($file)) {
    fwrite(STDERR, "espocrm-config: missing config file: {$file}\n");
    exit(1);
}

$config = include $file;
if (!is_array($config)) {
    fwrite(STDERR, "espocrm-config: {$file} did not return a configuration array\n");
    exit(1);
}

$mode = getenv('ESPO_CONFIG_MODE') ?: 'base';
if ($mode !== 'base' && $mode !== 'oidc') {
    fwrite(STDERR, "espocrm-config: unknown mode: {$mode}\n");
    exit(1);
}

$documentRoot = dirname($file);

/** A value start.sh must have exported; stops instead of writing an empty one. */
function env_required(string $name): string
{
    $value = getenv($name);
    if ($value === false || $value === '') {
        fwrite(STDERR, "espocrm-config: missing {$name}\n");
        exit(1);
    }
    return $value;
}

// Database and public origin. The credentials are the ones start.sh re-applies
// to MariaDB on the same start, and siteUrl is what EspoCRM builds the OIDC
// redirect_uri and absolute links from.
$config['database']['host'] = '127.0.0.1';
$config['database']['port'] = '3306';
$config['database']['dbname'] = 'espocrm';
$config['database']['user'] = 'espocrm';
$config['database']['password'] = env_required('ATO_BINDING_DB_PASSWORD');
$config['database']['charset'] = 'utf8mb4';
$config['siteUrl'] = rtrim(env_required('ESPOCRM_APP_URL'), '/');

if ($mode === 'oidc') {
    $publicIssuer = rtrim(env_required('ATO_OIDC_PUBLIC_ISSUER'), '/');
    $backchannel = rtrim(env_required('ESPO_OIDC_BACKCHANNEL_ISSUER'), '/');

    // The browser uses the public provider; the server side uses the relay.
    // The issuer is the public one, because that is the iss inside the
    // id_token; the individual endpoints may point elsewhere.
    $config['authenticationMethod'] = 'OIDC';
    $config['oidcIssuer'] = $publicIssuer;
    $config['oidcClientId'] = env_required('ATO_BINDING_OIDC_CLIENT_ID');
    $config['oidcClientSecret'] = env_required('ATO_BINDING_OIDC_CLIENT_SECRET');
    $config['oidcAuthorizationEndpoint'] = $publicIssuer . '/authorize';
    $config['oidcTokenEndpoint'] = $backchannel . '/token';
    $config['oidcUserinfoEndpoint'] = $backchannel . '/userinfo';
    $config['oidcJwksEndpoint'] = $backchannel . '/jwks';
    $config['oidcScopes'] = 'openid profile email';

    // Accounts are made from preferred_username and email at first sign-in and
    // get the role/team start.sh created. OIDC never creates an administrator.
    $config['oidcAutoCreateUser'] = true;
    $config['oidcUsernameClaim'] = 'preferred_username';
    $config['oidcEmailClaim'] = 'email';
    $config['oidcDefaultRole'] = env_required('ESPO_DEFAULT_ROLE_ID');
    $config['oidcDefaultTeam'] = env_required('ESPO_DEFAULT_TEAM_ID');

    // Regular users only have an OIDC account, so the standard password login
    // cannot be used by them; keeping it lets the administrator sign in with
    // the account the installation created.
    $config['oidcAllowStandardLogin'] = true;
}

// Write a complete PHP file next to the original and rename it into place, so
// a crash never leaves a half-written config.php behind.
$temporary = $file . '.ato-tmp';
$contents = "<?php\nreturn " . var_export($config, true) . ";\n";
if (file_put_contents($temporary, $contents) === false || !rename($temporary, $file)) {
    @unlink($temporary);
    fwrite(STDERR, "espocrm-config: cannot write {$file}\n");
    exit(1);
}

fwrite(STDERR, "espocrm-config: wrote {$mode} settings to {$file} ({$documentRoot})\n");
