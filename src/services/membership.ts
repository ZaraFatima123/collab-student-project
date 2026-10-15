import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import * as v from '../validation';
import { fail } from '../errors';
import { projectAccess, snapshot, transaction, Tx } from './access';

async function establishMembership(tx: Tx, projectId: string, userId: string, reviewerId: string, now = new Date()) {
  await tx.projectMember.upsert({ where: { projectId_userId: { projectId, userId } }, create: { projectId, userId }, update: {} });
  // Any successful membership path resolves both kinds of outstanding records.
  await tx.projectInvitation.updateMany({ where: { projectId, invitedUserId: userId, status: 'PENDING', expiresAt: { gt: now } }, data: { status: 'ACCEPTED', respondedAt: now } });
  await tx.projectInvitation.updateMany({ where: { projectId, invitedUserId: userId, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'REVOKED', respondedAt: now } });
  await tx.joinRequest.updateMany({ where: { projectId, userId, status: 'PENDING' }, data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: now } });
}
export class MembershipService {
  constructor(private db: PrismaClient) {}
  invite(userId: string, projectId: string, body: z.infer<typeof v.inviteCreate>) {
    return transaction(this.db, async tx => {
      await projectAccess(tx, projectId, userId, { write: true, manage: true });
      if (!await tx.user.findUnique({ where: { id: body.invitedUserId } })) fail(404, 'USER_NOT_FOUND', 'Invited user not found');
      if (await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: body.invitedUserId } } })) fail(409, 'ALREADY_MEMBER', 'User already belongs to the project');
      const now = new Date();
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : new Date(now.getTime() + 7 * 86400000);
      if (expiresAt <= now) fail(400, 'INVALID_EXPIRY', 'Invitation expiry must be in the future');
      // PostgreSQL cannot use now() in a partial-index predicate. Retire expired
      // PENDING records before relying on the unique pending-invitation index.
      await tx.projectInvitation.updateMany({ where: { projectId, invitedUserId: body.invitedUserId, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'REVOKED', respondedAt: now } });
      if (await tx.projectInvitation.findFirst({ where: { projectId, invitedUserId: body.invitedUserId, status: 'PENDING' } })) fail(409, 'INVITATION_PENDING', 'An active invitation already exists');
      return tx.projectInvitation.create({ data: { projectId, invitedUserId: body.invitedUserId, invitedById: userId, expiresAt } });
    });
  }
  invitations(userId: string, q: v.Paging, projectId?: string) {
    return snapshot(this.db, async tx => {
      if (projectId) await projectAccess(tx, projectId, userId, { manage: true });
      const where = projectId ? { projectId } : { invitedUserId: userId };
      const data = await tx.projectInvitation.findMany({ where, ...v.listArgs(q), include: { project: { select: { id: true, name: true, status: true } } } });
      return v.paginated(data, await tx.projectInvitation.count({ where }), q);
    });
  }
  respondInvitation(userId: string, invitationId: string, action: 'accept' | 'decline' | 'revoke', projectId?: string) {
    return transaction(this.db, async tx => {
      // Resolve only the project ID, then acquire its lock and re-read the record.
      const initial = await tx.projectInvitation.findFirst({ where: { id: invitationId, ...(projectId ? { projectId } : {}) }, select: { projectId: true } });
      if (!initial) fail(404, 'INVITATION_NOT_FOUND', 'Invitation not found in this project');
      await projectAccess(tx, initial.projectId, userId, { write: true, member: action === 'revoke', manage: action === 'revoke' });
      const invitation = await tx.projectInvitation.findUniqueOrThrow({ where: { id: invitationId } });
      if (action !== 'revoke' && invitation.invitedUserId !== userId) fail(403, 'INVITED_USER_REQUIRED', 'Only the invited user can respond');
      if (invitation.status !== 'PENDING') fail(409, 'INVITATION_NOT_PENDING', 'Invitation is no longer pending');
      if (action === 'accept') {
        const now = new Date();
        if (invitation.expiresAt <= now) fail(409, 'INVITATION_EXPIRED', 'Expired invitations cannot be accepted');
        await establishMembership(tx, invitation.projectId, userId, userId, now);
        return tx.projectInvitation.findUniqueOrThrow({ where: { id: invitationId } });
      }
      return tx.projectInvitation.update({ where: { id: invitationId }, data: { status: action === 'decline' ? 'DECLINED' : 'REVOKED', respondedAt: new Date() } });
    });
  }
  requestJoin(userId: string, projectId: string, body: z.infer<typeof v.joinCreate>) {
    return transaction(this.db, async tx => {
      const { project, member } = await projectAccess(tx, projectId, userId, { write: true, member: false });
      if (project.visibility !== 'DISCOVERABLE') fail(403, 'INVITATION_REQUIRED', 'Private projects require an invitation');
      if (project.status !== 'ACTIVE') fail(409, 'PROJECT_NOT_ACTIVE', 'Only active projects accept join requests');
      if (member) fail(409, 'ALREADY_MEMBER', 'You already belong to the project');
      if (await tx.joinRequest.findFirst({ where: { projectId, userId, status: 'PENDING' } })) fail(409, 'JOIN_REQUEST_PENDING', 'A pending join request already exists');
      return tx.joinRequest.create({ data: { ...body, projectId, userId } });
    });
  }
  requests(userId: string, q: v.Paging, projectId?: string) {
    return snapshot(this.db, async tx => {
      if (projectId) await projectAccess(tx, projectId, userId, { manage: true });
      const where = projectId ? { projectId } : { userId };
      const data = await tx.joinRequest.findMany({ where, ...v.listArgs(q), include: { project: { select: { id: true, name: true, status: true } } } });
      return v.paginated(data, await tx.joinRequest.count({ where }), q);
    });
  }
  review(userId: string, projectId: string, requestId: string, action: 'APPROVED' | 'REJECTED' | 'CANCELLED') {
    return transaction(this.db, async tx => {
      await projectAccess(tx, projectId, userId, { write: true, member: action !== 'CANCELLED', manage: action !== 'CANCELLED' });
      const request = await tx.joinRequest.findFirst({ where: { id: requestId, projectId } });
      if (!request) fail(404, 'JOIN_REQUEST_NOT_FOUND', 'Join request not found in this project');
      if (action === 'CANCELLED' && request.userId !== userId) fail(403, 'APPLICANT_REQUIRED', 'Only the applicant can cancel their request');
      if (request.status !== 'PENDING') fail(409, 'JOIN_REQUEST_NOT_PENDING', 'Join request is no longer pending');
      if (action === 'APPROVED') {
        await establishMembership(tx, projectId, request.userId, userId);
        return tx.joinRequest.findUniqueOrThrow({ where: { id: requestId } });
      }
      return tx.joinRequest.update({ where: { id: requestId }, data: { status: action, reviewedById: action === 'CANCELLED' ? null : userId, reviewedAt: new Date() } });
    });
  }
}
