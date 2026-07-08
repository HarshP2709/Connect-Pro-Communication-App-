'use strict';

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendEmail = async ({ to, subject, html, text }) => {
  if (!process.env.SMTP_USER) {
    logger.warn('SMTP not configured. Skipping email.');
    return { success: false, reason: 'SMTP not configured' };
  }
  try {
    const result = await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'ConnectPro <noreply@connectpro.io>',
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });
    logger.info(`Email sent to ${to}: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
  } catch (err) {
    logger.error(`Failed to send email to ${to}:`, err);
    return { success: false, reason: err.message };
  }
};

const sendMeetingInvite = async ({ to, hostName, meetingTitle, meetingId, scheduledAt, joinUrl }) => {
  return sendEmail({
    to,
    subject: `${hostName} invited you to "${meetingTitle}" on ConnectPro`,
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f1a; color: #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 40px; text-align: center;">
          <h1 style="margin: 0; font-size: 28px; color: white; letter-spacing: -0.5px;">ConnectPro</h1>
          <p style="margin: 8px 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">Premium Video Meeting Platform</p>
        </div>
        <div style="padding: 40px;">
          <h2 style="color: #c4b5fd; margin-top: 0;">You're invited!</h2>
          <p><strong>${hostName}</strong> has invited you to join a meeting.</p>
          <div style="background: #1e1e2e; border: 1px solid #2d2d3d; border-radius: 12px; padding: 24px; margin: 24px 0;">
            <h3 style="margin: 0 0 16px; color: #a78bfa;">${meetingTitle}</h3>
            <p style="margin: 0; color: #94a3b8;">Meeting ID: <strong style="color: #e2e8f0; font-family: monospace;">${meetingId}</strong></p>
            ${scheduledAt ? `<p style="margin: 8px 0 0; color: #94a3b8;">Scheduled: <strong style="color: #e2e8f0;">${new Date(scheduledAt).toLocaleString()}</strong></p>` : ''}
          </div>
          <a href="${joinUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 8px 0;">Join Meeting</a>
          <p style="margin-top: 24px; color: #64748b; font-size: 12px;">Or copy this link: ${joinUrl}</p>
        </div>
        <div style="padding: 20px; text-align: center; border-top: 1px solid #1e1e2e; color: #475569; font-size: 12px;">
          © ${new Date().getFullYear()} ConnectPro. All rights reserved.
        </div>
      </div>
    `,
  });
};

const sendPasswordReset = async ({ to, resetUrl }) => {
  return sendEmail({
    to,
    subject: 'Reset your ConnectPro password',
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Request</h2>
        <p>Click the link below to reset your password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display: inline-block; background: #6366f1; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; margin: 16px 0;">Reset Password</a>
        <p style="color: #64748b; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
};

module.exports = { sendEmail, sendMeetingInvite, sendPasswordReset };
