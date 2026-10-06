// READER-145. Sends Expo push notifications in chunks, and copes with the two failures the reminder cron used to
// swallow:
//
// 1. PUSH_TOO_MANY_EXPERIENCE_IDS. Expo rejects a whole request whose tokens belong to more than one Expo project.
//    That happens as soon as tokens issued under Langham's Expo project sit in push_token next to the ones issued under
//    BibleMesh's. The error's details map each project to its tokens, so the chunk is split along them and each part
//    is sent on its own. One project's tokens are never retried again, so a second failure is logged, not looped.
// 2. DeviceNotRegistered. A ticket with this error means the token is dead: the app was uninstalled or the token was
//    replaced. Those tokens are returned so the caller can retire them, instead of sending to them on every run.
//
// https://docs.expo.dev/push-notifications/sending-notifications/#request-errors

const sendChunk = async ({ expo, chunk, log, splitAllowed }) => {
  const deadTokens = []
  let sent = 0

  try {
    const tickets = await expo.sendPushNotificationsAsync(chunk)
    tickets.forEach((ticket, idx) => {
      if(ticket && ticket.status === 'error') {
        if(ticket.details && ticket.details.error === 'DeviceNotRegistered') {
          deadTokens.push(chunk[idx].to)
        } else {
          log(['Push notification ticket error', ticket.message, ticket.details], 3)
        }
      } else {
        sent++
      }
    })

  } catch(error) {
    if(splitAllowed && error.code === 'PUSH_TOO_MANY_EXPERIENCE_IDS' && error.details) {
      log(['Push notification chunk mixes Expo projects; sending one project at a time', Object.keys(error.details)], 2)
      const byToken = {}
      chunk.forEach(message => { byToken[message.to] = message })
      const parts = Object.values(error.details).map(tokens => (tokens || []).map(token => byToken[token]).filter(Boolean))
      // Any message whose token Expo did not list goes as one more part, so it is not dropped without a trace; Expo's
      // ticket for it then says what is wrong with it.
      const listed = new Set(parts.flat().map(message => message.to))
      parts.push(chunk.filter(message => !listed.has(message.to)))
      for(const part of parts) {
        if(part.length === 0) continue
        const result = await sendChunk({ expo, chunk: part, log, splitAllowed: false })
        sent += result.sent
        deadTokens.push(...result.deadTokens)
      }
    } else {
      log(['Could not send push notifications chunk', error, chunk.length], 3)
    }
  }

  return { sent, deadTokens }
}

const sendPushNotifications = async ({ expo, messages, log }) => {
  const deadTokens = []
  let sent = 0

  for(const chunk of expo.chunkPushNotifications(messages)) {
    const result = await sendChunk({ expo, chunk, log, splitAllowed: true })
    sent += result.sent
    deadTokens.push(...result.deadTokens)
  }

  return { sent, deadTokens }
}

module.exports = { sendPushNotifications }
