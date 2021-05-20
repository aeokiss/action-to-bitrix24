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
  iconUrl?: string;
  botName?: string;
};

type Bitrix24PostParam = {
  text: string;
  link_names: 0 | 1;
  username: string;
  icon_url?: string;
  icon_emoji?: string;
};

const defaultBotName = "Github Mention To Bitrix24";
const defaultIconEmoji = ":bell:";

export const Bitrix24RepositoryImpl = {
  postToBitrix24: async (
    webhookUrl: string,
    message: string,
    options?: Bitrix24Option
  ): Promise<void> => {
    const botName = (() => {
      const n = options?.botName;
      if (n && n !== "") {
        return n;
      }
      return defaultBotName;
    })();

    const bitrix24PostParam: Bitrix24PostParam = {
      text: message,
      link_names: 0,
      username: botName,
    };

    const u = options?.iconUrl;
    if (u && u !== "") {
      bitrix24PostParam.icon_url = u;
    } else {
      bitrix24PostParam.icon_emoji = defaultIconEmoji;
    }

    const page = "im.message.add.json"
    const params = "CHAT_ID=7047&SYSTEM=N&URL_PREVIEW=N"
    const url = webhookUrl + page + "?" + params + "&MESSAGE=" + encodeURI(message);
    await axios.get(url);
//    await axios.post(webhookUrl, JSON.stringify(bitrix24PostParam), {
//      headers: { "Content-Type": "application/json" },
//    });
  },
};
