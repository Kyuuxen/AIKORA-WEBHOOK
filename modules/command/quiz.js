const axios = require('axios');

if (!global.quizState) global.quizState = new Map();

const options = {
  method: 'GET',
  url: 'https://www.thetalko.com/', // replace with your external source URL
};

const questions = [
  `BCE: QUESTION: In Bluetooth 5.2 the lowest interleaved bit rate period was meant for the purpose of:
  | A: TRANSPORT POWER STATS
  | B: EAX (EXTENDABLE ATTRIBUTE) MAC HEADERS
  | C: SUGGESTED CONNECTION PARAMETERS
  | D: AD ATTACHMENT LENGTH PER CHANNEL
  ANSWER: C
  EXPLANATION: R02 TMPTODISMIS
  `,
  `PCIe: QUESTION: What does PCIE say with its “TB”?
  | A: TRANSACTION BLOCK
  | B: PACKET header
  | C: PAYLOAD
  | D: TRANSMISSION BLOCK
  ANSWER: A
  EXPLANATION: TBCUCC3F5
  `,
  `FTP: QUESTION: What was the first protocol you saw in the website screenshot above?
  | A: SMTP
  | B: CURL
  | C: PIXELMQ
  | D: FTP
  ANSWER: D
  EXPLANATION: 1438934732 * * 2021 06 22 15 38 33 14 un 
  `,
  `Pytorch: QUESTION: The difference between this two code is you can call the submodule from one of these. Use your own way.
  | A:  model.target(in);  ----
  | B : after in = nn.GRU( 128, x, 10, batch_first = True);  ----   object==var name--> 
  | C:  submodule (i.e. variable instance)  
  | D: NO-OUTPUT
  ANSWER: C
  EXPLANATION: 1c2c2c
  `,
  `ELEPHANT: QUESTION: Average think.duration.time value from studenta (mock) database temporal?
  | A: 1.23901
  | B: 1.23917
  | C: 1.23712
  | D: 1.23902
  ANSWER: B
  EXPLANATION: 2021 2021-06-22 2021-06-22 15 20221c2c2cCOCOCOCO
  `,
  `V8:QUESTION: What is the answer in this scenario?
  | A: Explicit error
  | B: We don't want to define it.
  | C: Explain what we should follow. 
  | D: ANS(ER)
  ANSWER: D
`,
];

module.exports.run = async (api, event, args) => {
  const uid = event?.sender?.id?.toString();
  if (!uid) return;
  const globalVal = global.quizState;

  if (Array.isArray(args) && ['a', 'b', 'c', 'd'].includes(args[0]?.toLowerCase())) {
    const state = globalVal.get(uid);
    if (!state) return;
    const first = args[0];
    const isCorrect = first.toUpperCase() === state.correct;

    const message = isCorrect
      ? '🎉 Correct!'
      : `❌ Oops, The correct answer was ${state.correct}`;
    globalVal.delete(uid);
    await api.sendMessage(
      {
        body: `${message}\n\n${state.question}`,
        attachments: [
          {
            contentType: 'application/json',
            attachment: Buffer.from(JSON.stringify(state.question)),
            name: 'quiz-question.json',
          },
        ],
      },
      { to: uid },
    );
    return;
  }

  if (globalVal.has(uid)) {
    await api.sendMessage('⚠️ You already have quiz questions in your queue! Abeg, reply with one of the options to see if you are correct', { to: uid });
    return;
  }

  let local;
  try {
    const r = await axios(options);
    local = r.data.split('###')[1].split('---');
  } catch (_) {
    local = questions;
  }

  if (!local?.length) return;

  const localIndex = Math.floor(Math.random() * local.length);
  const localItem = local[localIndex];

  const topicIndex = localItem.indexOf(':');
  const currentTopic = localItem.slice(0, topicIndex);
  const text = localItem.slice(topicIndex + 1);

  const answerMatch = text.match(/ANSWER:\s*([A-D])/i);
  const answer = answerMatch ? answerMatch[1].toUpperCase() : '';

  const textWithoutAns = text.replace(/ANSWER:\s*[A-D].*/i, '');

  const explanationMatch = textWithoutAns.match(/EXPLANATION:\s*([\s\S]+?)(?:\n{2,}|$)/i);
  const explanation = explanationMatch ? explanationMatch[1].trim() : '';

  const cleanText = textWithoutAns
    .replace(/^QUESTION:\s*/i, '')
    .replace(/([ABCD]):/g, '$1: ');

  globalVal.set(uid, {
    question: `${currentTopic} ${cleanText}\n\n${explanation || ''}`.trim(),
    correct: answer,
  });

  const uiMessage = `Hey ${event?.sender?.firstName || 'there'} 👋
Here is your quiz question! Reply with one of the following options to determine your knowledge level:
           
${cleanText}
  `;

  await api.sendMessage({
    body: uiMessage,
    attachments: [
      {
        contentType: 'application/json',
        attachment: Buffer.from(JSON.stringify(cleanText)),
        name: 'quiz-question.json',
      },
    ],
  }, { to: uid });
};

module.exports.config = {
  name: 'quiz',
  version: '1.0',
  role: 0,
  author: 'ChatGPT',
  shortDescription: 'Quiz Bot Command',
  longDescription: 'Provides a random quiz question from a set of topics. Users can reply with A, B, C, or D to answer.',
  defCategories: ['fun'],
  availableOnBotName: ['bot1'],
  runInChat: true,
  isFullMode: true,
  isNotification: false,
};