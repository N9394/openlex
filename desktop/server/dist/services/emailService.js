"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPasswordResetEmail = sendPasswordResetEmail;
exports.sendNewDeviceLoginAlert = sendNewDeviceLoginAlert;
exports.sendVerificationEmail = sendVerificationEmail;
async function sendPasswordResetEmail(email, token, username) {
    console.log(`[EMAIL STUB] Would send password reset to ${email}`);
}
async function sendNewDeviceLoginAlert(email, deviceInfo, ipAddress) {
    console.log(`[EMAIL STUB] Would send device login alert to ${email}`);
}
async function sendVerificationEmail(email, token) {
    console.log(`[EMAIL STUB] Would send verification email to ${email}`);
}
//# sourceMappingURL=emailService.js.map