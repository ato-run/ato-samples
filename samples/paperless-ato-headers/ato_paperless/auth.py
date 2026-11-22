"""Remote-user account provisioning for the Ato Paperless-ngx capsule.

Paperless 3.5.1 reads PAPERLESS_ACCOUNT_DEFAULT_GROUPS in
CustomAccountAdapter.save_user only. Accounts the HTTP remote-user middleware
creates are made by Django's stock RemoteUserBackend and never pass through
that adapter, so they end up with no groups and no permissions: the document
list is 403, uploading a document is 403. This module subclasses the stock
backend and applies Paperless's own setting to the account it creates. No
Paperless code is modified; ato_paperless.settings is selected with
DJANGO_SETTINGS_MODULE by start.sh.

ensure_default_group() creates the group and grants the model permissions a
regular user needs. Document visibility does not come from these permissions:
Paperless filters every document queryset to the documents the person owns or
has been granted (PermittedObjectsFilter), so the group cannot expose somebody
else's documents.
"""
from django.conf import settings
from django.contrib.auth.backends import RemoteUserBackend
from django.contrib.auth.models import Group
from django.contrib.auth.models import Permission


class AtoRemoteUserBackend(RemoteUserBackend):
    """RemoteUserBackend that applies PAPERLESS_ACCOUNT_DEFAULT_GROUPS."""

    def configure_user(self, request, user, created=True):
        user = super().configure_user(request, user, created=created)
        if created:
            groups = Group.objects.filter(name__in=settings.ACCOUNT_DEFAULT_GROUPS)
            if groups:
                user.groups.add(*groups)
        return user


def ensure_default_group():
    """Make sure every default group exists with the regular-user permissions.

    The permissions granted are Paperless's own model permissions for the
    documents app (documents, tags, correspondents, document types, storage
    paths, saved views, custom fields, notes, share links and tasks). They are
    idempotent additions: a group an administrator edited later keeps its
    changes, because nothing is removed.
    """
    regular_user_permissions = Permission.objects.filter(
        content_type__app_label="documents",
    )
    for name in settings.ACCOUNT_DEFAULT_GROUPS:
        group, _created = Group.objects.get_or_create(name=name)
        group.permissions.add(*regular_user_permissions)
