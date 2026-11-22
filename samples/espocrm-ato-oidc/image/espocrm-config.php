<?php
/**
 * Merge the Ato bindings into EspoCRM's data/config.php.
 *
 * EspoCRM 9.3.11's installer writes data/config.php and the application keeps
 * its settings there (internal settings go to data/config-internal.php, which
 * EspoCRM writes itself). start.sh re-applies the database credentials, the
 * public site URL and the OpenID Connect settings on every start by rewriting
 * the same file the installer wrote. Nothing is kept outside the state
 * directory.
 *
 * The keys and values below are the ones EspoCRM 9.3.11 reads, from
 * application/Espo/Core/Authentication/Oidc/ConfigDataProvider.php and
 * application/Espo/Resources/defaults/config.php. In particular:
 *   - authenticationMethod is the method name "Oidc" (not "OIDC");
 *   - the token/userinfo/JWKS endpoints are separate settings, so the browser
 *     can use the public provider while the server side uses the Runner's
 *     relay; there is no issuer setting and no redirect-URI setting (it is
 *     siteUrl + "/oauth-callback.php");
 *   - the email address is read from the "email" claim, with no claim-name
 *     setting; the username claim is oidcUsernameClaim;
 *   - there is no oidcAutoCreateUser / oidcDefaultRole / oidcDefaultTeam /
 *     oidcAllowStandardLogin. The real keys are oidcCreateUser, oidcTeamsIds
 *     (a list of team ids; the default role is attached to that team) and
 *     oidcFallback / oidcAllowRegularUserFallback / oidcAllowAdminUser.
 *
 * Modes:
 *   base  database credentials and siteUrl only. Used after the installation
 *         and before the administrator API calls, so they see the current
 *         password.
 *   oidc  base, plus the OpenID Connect settings, the team that carries the
 *         default role for accounts created at first sign-in, and the
 *         administrator's password login fallback.
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
    $teamId = env_required('ESPO_DEFAULT_TEAM_ID');

    // The browser is sent to the public provider; the token, userinfo and JWKS
    // requests are made server-side through the Runner's relay. EspoCRM's
    // curl calls allow http (CURLPROTO_HTTP), so the relay needs no TLS
    // forwarder; the issuer in the id_token is not compared with any setting.
    $config['authenticationMethod'] = 'Oidc';
    $config['oidcClientId'] = env_required('ATO_BINDING_OIDC_CLIENT_ID');
    $config['oidcClientSecret'] = env_required('ATO_BINDING_OIDC_CLIENT_SECRET');
    $config['oidcAuthorizationEndpoint'] = $publicIssuer . '/authorize';
    $config['oidcTokenEndpoint'] = $backchannel . '/token';
    $config['oidcUserInfoEndpoint'] = $backchannel . '/userinfo';
    $config['oidcJwksEndpoint'] = $backchannel . '/jwks';
    $config['oidcJwtSignatureAlgorithmList'] = ['RS256'];
    $config['oidcScopes'] = ['profile', 'email'];

    // Accounts are created from the username claim at first sign-in and get
    // the team that carries the default role. OIDC never creates an
    // administrator and never matches an account by address.
    $config['oidcCreateUser'] = true;
    $config['oidcUsernameClaim'] = 'preferred_username';
    $config['oidcTeamsIds'] = [$teamId];
    $config['oidcSync'] = false;
    $config['oidcSyncTeams'] = false;

    // The standard password login stays available for the administrator (the
    // installer's account), but not for regular users: they have no known
    // password and are refused the fallback. OIDC-created users are always
    // "regular"; an admin account cannot be reached through OIDC.
    $config['oidcFallback'] = true;
    $config['oidcAllowRegularUserFallback'] = false;
    $config['oidcAllowAdminUser'] = false;

    // The provider ignores an ordinary consent prompt; it is the field the
    // login window sends. "none" would mean no browser interaction.
    $config['oidcAuthorizationPrompt'] = 'consent';
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

fwrite(STDERR, "espocrm-config: wrote {$mode} settings to {$file}\n");
