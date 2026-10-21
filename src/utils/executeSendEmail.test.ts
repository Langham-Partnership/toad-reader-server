// READER-149. executeSendEmail against a stand-in SES v3 client. The first v3 version called .then on the
// SendEmailCommand instead of on sesClient.send(), so it threw before SES was called; this test fails on that code.

const mockSend = jest.fn();
const mockLog = jest.fn();

jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn(() => ({ send: mockSend })),
  SendEmailCommand: jest.fn((input: unknown) => ({ input })),
}));
jest.mock('./logger', () => ({ log: mockLog }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const executeSendEmail = require('./executeSendEmail');

const queuedEmail = {
  toAddrs: ['reader@example.org'],
  ccAddrs: [],
  bccAddrs: [],
  fromAddr: 'support@readlangham.org',
  replyToAddrs: ['support@readlangham.org'],
  subject: 'Login code: 123456',
  body: '<p>123456</p>',
};

const run = () =>
  new Promise((resolve, reject) =>
    executeSendEmail({ queuedEmail, resolve, reject }),
  );

describe('executeSendEmail', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the message through the SES client and resolves true', async () => {
    mockSend.mockResolvedValue({ MessageId: 'abc' });

    await expect(run()).resolves.toBe(true);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [{ input }] = mockSend.mock.calls[0];
    expect(input).toMatchObject({
      Source: 'support@readlangham.org',
      Destination: { ToAddresses: ['reader@example.org'] },
      Message: {
        Subject: { Data: 'Login code: 123456' },
        Body: { Html: { Data: '<p>123456</p>' } },
      },
      ReplyToAddresses: ['support@readlangham.org'],
    });
  });

  it('rejects with the SES error message and logs it', async () => {
    mockSend.mockRejectedValue(new Error('Email address is not verified.'));

    await expect(run()).rejects.toBe('Email address is not verified.');
    expect(mockLog).toHaveBeenCalledWith(
      expect.arrayContaining(['Email error: ']),
      3,
    );
    // The subject and body hold the login code, so they must not reach the log.
    const logged = JSON.stringify(mockLog.mock.calls);
    expect(logged).not.toContain('123456');
  });
});
