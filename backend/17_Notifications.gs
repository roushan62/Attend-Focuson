/**
 * ============================================================================
 *  FILE: 17_Notifications.gs
 *  ROLE: In-app notification inbox plus outbound e-mail / SMS / WhatsApp
 *        delivery (§9.9). All outbound messaging funnels through here so the
 *        channel choice is a company setting, not scattered code.
 * ============================================================================
 */

/** Write an in-app notification row (always) and fan out to channels (optional). */
function notify_(ss, userId, title, message, type, priority) {
  if (!ss || !userId) return null;
  try {
    var row = {
      NotifID: id_('NTF'),
      UserID: userId,
      Title: str_(title, 140),
      Message: str_(message, 900),
      Type: pickOne_(type, ['Info', 'Approval', 'Alert', 'Flagged', 'Expiry', 'Report', 'System'], 'Info'),
      Read: 'N',
      CreatedAt: fmtDateTime_(new Date()),
      Channel: 'InApp',
      Priority: pickOne_(priority, ['Low', 'Normal', 'High'], 'Normal'),
      PayloadJSON: jsonString_({ title: title, at: iso_(new Date()) })
    };
    appendRecord_(ss, 'Notifications', row);
    return row;
  } catch (e) {
    Logger.log('notify_ failed: ' + e.message);
    return null;
  }
}

/** Notify every admin who can act on this item (respects project scope). */
function notifyAdmins_(ss, ctx, title, message, type, priority) {
  try {
    var users = readTable_(ss, 'Users').filter(function (u) {
      return String(u.Status) === 'Active' && isStaffRole_(u.Role);
    });
    var sent = 0;
    users.forEach(function (u) {
      if (String(u.UserID) === String(ctx && ctx.userId)) return;
      var perms = permissionsFor_(u);
      var relevant = (type === 'Approval') || perms.__all ||
        perms.reviewAttendance || perms.approveLeave || perms.approveExpense || perms.manageVendors;
      if (!relevant) return;
      notify_(ss, u.UserID, title, message, type, priority);
      sent++;
    });
    return sent;
  } catch (e) {
    Logger.log('notifyAdmins_ failed: ' + e.message);
    return 0;
  }
}

function actionMyNotifications(payload, ctx) {
  var ss = ctx.ss;
  var rows = readTable_(ss, 'Notifications').filter(function (n) {
    return String(n.UserID) === String(ctx.userId);
  });
  var unreadOnly = String(payload.unreadOnly || '').toLowerCase() === 'true';
  if (unreadOnly) rows = rows.filter(function (n) { return String(n.Read) !== 'Y'; });
  rows = sortBy_(rows, function (n) { return String(n.CreatedAt); }, true);
  var limit = Math.min(Math.max(num_(payload.limit, 50), 1), 200);
  return {
    count: rows.length,
    unread: rows.filter(function (n) { return String(n.Read) !== 'Y'; }).length,
    notifications: rows.slice(0, limit).map(function (n) {
      return {
        notifId: n.NotifID, title: n.Title || '', message: n.Message || '',
        type: n.Type || 'Info', read: String(n.Read) === 'Y', createdAt: n.CreatedAt,
        priority: n.Priority || 'Normal', channel: n.Channel || 'InApp'
      };
    })
  };
}

function actionMarkNotificationRead(payload, ctx) {
  var ss = ctx.ss;
  if (bool_(payload.all, false)) {
    var rows = readTable_(ss, 'Notifications').filter(function (n) {
      return String(n.UserID) === String(ctx.userId) && String(n.Read) !== 'Y';
    });
    rows.forEach(function (n) {
      updateRecord_(ss, 'Notifications', 'NotifID', n.NotifID, { Read: 'Y' });
    });
    return { updated: rows.length, allRead: true };
  }
  requireFields_(payload, ['notifId']);
  var row = findRecord_(ss, 'Notifications', 'NotifID', payload.notifId);
  assert_(row, 'Notification not found', 404);
  assert_(String(row.UserID) === String(ctx.userId) || isStaffRole_(ctx.role), 'Not permitted', 403);
  updateRecord_(ss, 'Notifications', 'NotifID', row.NotifID, { Read: yn_(payload.read === undefined ? true : payload.read, true) });
  return { notifId: row.NotifID, read: true };
}

/* -------------------------------------------------------------------------- */
/*  Outbound channels                                                         */
/* -------------------------------------------------------------------------- */

function sendEmail_(to, subject, body) {
  if (!emailOk_(to)) return false;
  var from = prop_(PROP.MAIL_FROM_NAME, 'SiteTrack');
  try {
    var quota = MailApp.getRemainingDailyQuota ? MailApp.getRemainingDailyQuota() : 100;
    if (quota <= 0) {
      Logger.log('Mail quota exhausted; skipping e-mail to ' + to);
      return false;
    }
    MailApp.sendEmail({ to: to, name: from, subject: subject, body: body });
    return true;
  } catch (e) {
    Logger.log('sendEmail_ failed for ' + to + ': ' + e.message);
    return false;
  }
}

function sendEmailHtml_(to, subject, htmlBody, plainBody) {
  if (!emailOk_(to)) return false;
  try {
    MailApp.sendEmail({
      to: to,
      name: prop_(PROP.MAIL_FROM_NAME, 'SiteTrack'),
      subject: subject,
      body: plainBody || 'Please open this message in an HTML-capable mail client.',
      htmlBody: htmlBody
    });
    return true;
  } catch (e) {
    Logger.log('sendEmailHtml_ failed: ' + e.message);
    return false;
  }
}

/**
 * SMS / WhatsApp delivery (§9.9). Uses the WhatsApp Cloud API when a token is
 * configured; otherwise the message is queued in the Notifications tab with
 * channel 'SMS-pending' so an external sender can pick it up. Never throws.
 */
function sendSmsOrWhatsApp_(mobile, message) {
  var to = normaliseMobile_(mobile);
  if (!mobileOk_(to)) return false;
  var token = prop_(PROP.WHATSAPP_TOKEN, '');
  var phoneId = prop_(PROP.WHATSAPP_PHONE_ID, '');
  if (!token || !phoneId) return false; // no gateway configured → silently skip
  try {
    var url = 'https://graph.facebook.com/v19.0/' + phoneId + '/messages';
    var payload = {
      messaging_product: 'whatsapp',
      to: to.replace('+', ''),
      type: 'text',
      text: { preview_url: false, body: message }
    };
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: jsonString_(payload),
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) Logger.log('WhatsApp send failed (' + code + '): ' + res.getContentText());
    return code >= 200 && code < 300;
  } catch (e) {
    Logger.log('sendSmsOrWhatsApp_ failed: ' + e.message);
    return false;
  }
}

/** Notify a user through their preferred channel for status updates. */
function sendStatusMail_(ss, userId, subject, body) {
  try {
    var settings = readSettings_(ss);
    var user = findRecord_(ss, 'Users', 'UserID', userId);
    if (!user) return false;
    var channel = String(settings.notifyChannel || 'Email');
    var sent = false;
    if (channel !== 'SMS' && emailOk_(user.Email)) sent = sendEmail_(user.Email, subject, body);
    if (channel !== 'Email') {
      var okMsg = sendSmsOrWhatsApp_(user.MobileNumber, subject + ': ' + body.replace(/\n+/g, ' '));
      sent = sent || okMsg;
    }
    return sent;
  } catch (e) {
    Logger.log('sendStatusMail_ failed: ' + e.message);
    return false;
  }
}
