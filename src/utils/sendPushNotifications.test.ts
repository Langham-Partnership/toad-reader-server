// READER-145. Every test breaks the send on purpose: the point of the helper is what happens when Expo refuses.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendPushNotifications } = require('./sendPushNotifications');

type Message = { to: string; title?: string };
type Ticket = {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
};

const token = (name: string) => `ExponentPushToken[${name}]`;

const fakeExpo = (send: (chunk: Message[]) => Promise<Ticket[]>) => ({
  chunkPushNotifications: (messages: Message[]) => [messages],
  sendPushNotificationsAsync: jest.fn(send),
});

const tooManyProjects = (details: Record<string, string[]>) =>
  Object.assign(new Error('mixed projects'), {
    code: 'PUSH_TOO_MANY_EXPERIENCE_IDS',
    details,
  });

describe('sendPushNotifications', () => {
  const log = jest.fn();

  it('sends a chunk of one project in one request', async () => {
    const expo = fakeExpo(async (chunk) =>
      chunk.map(() => ({ status: 'ok' as const })),
    );
    const result = await sendPushNotifications({
      expo,
      messages: [{ to: token('a') }, { to: token('b') }],
      log,
    });
    expect(result).toEqual({ sent: 2, deadTokens: [] });
    expect(expo.sendPushNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('splits a chunk that mixes Expo projects and sends each project on its own', async () => {
    const oldProject = [token('biblemesh-1'), token('biblemesh-2')];
    const newProject = [token('langham-1')];
    const expo = fakeExpo(async (chunk) => {
      const tokens = chunk.map((m) => m.to);
      if (
        tokens.some((t) => oldProject.includes(t)) &&
        tokens.some((t) => newProject.includes(t))
      ) {
        throw tooManyProjects({
          '@biblemesh/langham-ereader': oldProject,
          '@langham-publishing/ereader': newProject,
        });
      }
      return chunk.map(() => ({ status: 'ok' as const }));
    });

    const result = await sendPushNotifications({
      expo,
      messages: [...oldProject, ...newProject].map((to) => ({ to })),
      log,
    });

    expect(result.sent).toBe(3);
    expect(expo.sendPushNotificationsAsync).toHaveBeenCalledTimes(3); // the refused one, then one per project
  });

  it('returns DeviceNotRegistered tokens so they can be retired, and counts only the others as sent', async () => {
    const expo = fakeExpo(async () => [
      { status: 'ok' },
      {
        status: 'error',
        message: 'gone',
        details: { error: 'DeviceNotRegistered' },
      },
      {
        status: 'error',
        message: 'other',
        details: { error: 'MessageRateExceeded' },
      },
    ]);
    const result = await sendPushNotifications({
      expo,
      messages: [
        { to: token('live') },
        { to: token('dead') },
        { to: token('throttled') },
      ],
      log,
    });
    expect(result).toEqual({ sent: 1, deadTokens: [token('dead')] });
  });

  it('does not split again if one project on its own is refused, so it cannot loop', async () => {
    const expo = fakeExpo(async () => {
      throw tooManyProjects({
        '@one/project': [token('x')],
        '@two/project': [token('y')],
      });
    });
    const result = await sendPushNotifications({
      expo,
      messages: [{ to: token('x') }, { to: token('y') }],
      log,
    });
    expect(result).toEqual({ sent: 0, deadTokens: [] });
    expect(expo.sendPushNotificationsAsync).toHaveBeenCalledTimes(3); // the mixed chunk, then each part once
  });

  it('still sends a message whose token Expo left out of the split details, rather than dropping it', async () => {
    const listed = [token('old'), token('new')];
    const expo = fakeExpo(async (chunk) => {
      if (chunk.length === 3) {
        throw tooManyProjects({
          '@biblemesh/langham-ereader': [listed[0]],
          '@langham-publishing/ereader': [listed[1]],
        });
      }
      return chunk.map(() => ({ status: 'ok' as const }));
    });
    const result = await sendPushNotifications({
      expo,
      messages: [
        { to: listed[0] },
        { to: listed[1] },
        { to: token('unlisted') },
      ],
      log,
    });
    expect(result.sent).toBe(3);
    expect(expo.sendPushNotificationsAsync).toHaveBeenCalledTimes(4); // mixed chunk, two projects, the unlisted one
  });

  it('logs any other request error and carries on', async () => {
    const expo = fakeExpo(async () => {
      throw Object.assign(new Error('network'), { code: 'ECONNRESET' });
    });
    const result = await sendPushNotifications({
      expo,
      messages: [{ to: token('a') }],
      log,
    });
    expect(result).toEqual({ sent: 0, deadTokens: [] });
  });
});
