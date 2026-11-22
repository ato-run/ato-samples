"""Django settings for the Ato Paperless-ngx capsule.

These are Paperless's own settings (imported unchanged from paperless.settings)
with one addition: the HTTP remote-user authentication backend is replaced by
the one in ato_paperless.auth, which applies PAPERLESS_ACCOUNT_DEFAULT_GROUPS to
the accounts the header creates. Paperless 3.5.1 applies that setting only in
CustomAccountAdapter.save_user (the allauth sign-up and social paths), and the
header backend it installs is Django's stock RemoteUserBackend, which leaves a
new account without groups or permissions. Nothing else is changed.

start.sh selects this module with DJANGO_SETTINGS_MODULE so the web server, the
Celery worker, the scheduler and the migration command all use it.
"""
from paperless.settings import *  # noqa: F401,F403
from paperless.settings import AUTHENTICATION_BACKENDS

AUTHENTICATION_BACKENDS = [
    "ato_paperless.auth.AtoRemoteUserBackend"
    if backend == "django.contrib.auth.backends.RemoteUserBackend"
    else backend
    for backend in AUTHENTICATION_BACKENDS
]
