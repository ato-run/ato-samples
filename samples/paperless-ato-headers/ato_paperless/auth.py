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


# Models whose rows belong to one person (ModelWithOwner, filtered by
# PermittedObjectsFilter) or hang off one document. Every action is granted.
OWNED_MODELS = (
    "correspondent",
    "tag",
    "documenttype",
    "storagepath",
    "document",
    "savedview",
    "savedviewfilterrule",
    "uisettings",
    "paperlesstask",
    "note",
    "sharelink",
    "sharelinkbundle",
    "customfieldinstance",
)
# Models that apply to EVERY person's documents and have no owner. A regular
# account must not hold these: a workflow can assign itself permissions on
# documents other people add, and deleting a custom field deletes everybody's
# values in it. Custom fields may still be seen and filled in.
INSTALLATION_WIDE_CODENAMES = (
    "add_customfield",
    "change_customfield",
    "delete_customfield",
)
INSTALLATION_WIDE_MODELS = (
    "workflow",
    "workflowtrigger",
    "workflowaction",
    "workflowactionemail",
    "workflowactionwebhook",
    "workflowrun",
)


def ensure_default_group():
    """Make sure every default group exists with the regular-user permissions.

    A regular account gets every permission on the models in OWNED_MODELS and
    may view custom fields. Additions are idempotent and other permissions an
    administrator gives the group are kept, except the installation-wide ones
    above, which are taken away again on every start: give those to a separate
    group instead.
    """
    documents = Permission.objects.filter(content_type__app_label="documents")
    regular_user_permissions = documents.filter(
        content_type__model__in=OWNED_MODELS,
    ) | documents.filter(codename="view_customfield")
    installation_wide = documents.filter(
        content_type__model__in=INSTALLATION_WIDE_MODELS,
    ) | documents.filter(codename__in=INSTALLATION_WIDE_CODENAMES)
    for name in settings.ACCOUNT_DEFAULT_GROUPS:
        group, _created = Group.objects.get_or_create(name=name)
        group.permissions.add(*regular_user_permissions)
        group.permissions.remove(*installation_wide)
