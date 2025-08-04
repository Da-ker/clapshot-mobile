from __future__ import annotations

import clapshot_grpc.proto.clapshot.organizer as org
from grpclib import GRPCError
from grpclib.const import Status as GrpcStatus

import organizer


def check_upload_permission(ses: org.UserSessionData) -> bool | None:
    """Check if user has upload permission based on X-Remote-User-Can-Upload header.
    
    Returns:
        True if upload is allowed
        False if upload is denied  
        None if no header found (should fall back to server default)
    """
    # Look for X-Remote-User-Can-Upload header (normalized to lowercase)
    for header_name, header_value in ses.http_headers.items():
        if header_name.lower() in ['x-remote-user-can-upload', 'x_remote_user_can_upload']:
            return header_value.strip().lower() in ['true', '1', 'yes']
    
    # No header found - should fall back to server default
    return None


async def authz_user_action_impl(oi: organizer.OrganizerInbound, authz_user_action_request: org.AuthzUserActionRequest) -> org.AuthzResponse:
    """Check upload authorization based on X-Remote-User-Can-Upload header."""
    ses = authz_user_action_request.ses

    # Handle upload media file authorization
    if (hasattr(authz_user_action_request, 'other_op') and
        authz_user_action_request.other_op and
        authz_user_action_request.other_op.op == org.AuthzUserActionRequestOtherOpOp.UPLOAD_MEDIA_FILE):

        oi.log.debug(f"Upload auth check for '{ses.user.id}'")

        upload_permission = check_upload_permission(ses)
        if upload_permission is True:
            return org.AuthzResponse(is_authorized=True)
        elif upload_permission is False:
            return org.AuthzResponse(
                is_authorized=False,
                message="Upload permission denied",
                details="Your account does not have upload permissions. Contact your administrator.")
        # upload_permission is None - fall back to server default

    # All other operations use server default authorization
    raise GRPCError(GrpcStatus.UNIMPLEMENTED)