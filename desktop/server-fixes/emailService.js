"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPasswordResetEmail = sendPasswordResetEmail;
exports.sendNewDeviceLoginAlert = sendNewDeviceLoginAlert;
exports.sendVerificationEmail = sendVerificationEmail;
exports.sendInviteEmail = sendInviteEmail;

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

async function sendPasswordResetEmail(email, token, username) {
    const resetUrl = `${CLIENT_URL}/reset-password?token=${token}`;
    console.log(`[EMAIL] Password reset for ${email}: ${resetUrl}`);
}

async function sendNewDeviceLoginAlert(email, deviceInfo, ipAddress) {
    console.log(`[EMAIL] Device login alert for ${email} from ${ipAddress}`);
}

async function sendVerificationEmail(email, token) {
    console.log(`[EMAIL] Verification email for ${email}`);
}

async function sendInviteEmail(email, invitationId, orgName) {
    const inviteUrl = `${CLIENT_URL}/invite/${invitationId}`;
    console.log(`[EMAIL] Team invitation for ${email} to join "${orgName}": ${inviteUrl}`);
}
