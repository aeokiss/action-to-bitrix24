import axios from "axios";

export const buildBitrix24PostMessage = (
  bitrix24IdsForMention: string[],
  issueTitle: string,
  commentLink: string,
  githubBody: string,
  senderName: string
): string => {
  const mentionBlock = bitrix24IdsForMention.map((id) => `<@${id}>`).join(" ");
  const body = githubBody
    .split("\n")
    .map((line, i) => {
      // fix bitrix24 layout collapse problem when first line starts with blockquotes.
      if (i === 0 && line.startsWith(">")) {
        return `>\n> ${line}`;
      }

      return `> ${line}`;
    })
    .join("\n");

  const message = [
    mentionBlock,
    `${bitrix24IdsForMention.length === 1 ? "has" : "have"}`,
    `been mentioned at <${commentLink}|${issueTitle}> by ${senderName}`,
  ].join(" ");

  return `${message}\n${body}`;
};

const openIssueLink =
  "https://github.com/aeokiss/action-to-bitrix24/issues/new";

export const buildBitrix24ErrorMessage = (
  error: Error,
  currentJobUrl?: string
): string => {
  const jobTitle = "mention-to-bitrix24 action";
  const jobLinkMessage = currentJobUrl
    ? `<${currentJobUrl}|${jobTitle}>`
    : jobTitle;

  const issueBody = error.stack
    ? encodeURI(["```", error.stack, "```"].join("\n"))
    : "";
  const link = `${openIssueLink}?title=${error.message}&body=${issueBody}`;

  return [
    `❗ An internal error occurred in ${jobLinkMessage}`,
    "(but action didn't fail as this action is not critical).",
    `To solve the problem, please <${link}|open an issue>`,
    "",
    "```",
    error.stack || error.message,
    "```",
  ].join("\n");
};

export type Bitrix24Option = {
  chatId?: string;
  botName?: string;
};

const defaultBotName = "Github Mention To Bitrix24";

export const Bitrix24RepositoryImpl = {
  postToBitrix24: async (
    webhookUrl: string,
    message: string,
    notiBitrix24Ids: number[],
    notiMessage: string,
    options?: Bitrix24Option
  ): Promise<void> => {
    const botName = (() => {
      const n = options?.botName;
      if (n && n !== "") {
        return n;
      }
      return defaultBotName;
    })();

    // send message to chat
    const chat_page = "im.message.add.json";
//    const chat_params = "CHAT_ID=" + options?.chatId + "&URL_PREVIEW=N&SYSTEM=N";
    const chat_params = "CHAT_ID=" + options?.chatId + "&URL_PREVIEW=N";
    const chat_url = webhookUrl + chat_page + "?" + chat_params + "&MESSAGE=" + encodeURI("[B]" + botName + "[/B]\n" + message);
    await axios.get(chat_url);

    // send notification
    const noti_page = "im.notify.personal.add.json";
    for (const value of notiBitrix24Ids) {
//      const noti_params = "USER_ID=" + value + "&TAG=" + encodeURI(notiMessage);
      const noti_params = "USER_ID=" + value;
      const noti_url = webhookUrl + noti_page + "?" + noti_params + "&MESSAGE=" + encodeURI(notiMessage + "\n[CHAT=" + options?.chatId + "]Go to Chat...[/CHAT]");
      if (value === 225) // for test (only to Tony)
        await axios.get(noti_url);
    };
  },
};
