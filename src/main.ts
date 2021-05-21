import * as core from "@actions/core";
import { context } from "@actions/github";
import { Context } from "@actions/github/lib/context";
import { WebhookPayload } from "@actions/github/lib/interfaces";

import {
  pickupUsername,
//  pickupInfoFromGithubPayload,
  GithubRepositoryImpl,
} from "./modules/github";
import {
//  buildBitrix24PostMessage,
  buildBitrix24ErrorMessage,
  Bitrix24RepositoryImpl,
} from "./modules/bitrix24";

export type AllInputs = {
  repoToken: string;
  configurationPath: string;
  bitrix24WebhookUrl: string;
  debugFlag: boolean;
  chatId?: string;
  botName?: string;
  runId?: string;
};

export const convertToBitrix24Username = async (
  githubUsernames: string[],
  githubClient: typeof GithubRepositoryImpl,
  repoToken: string,
  configurationPath: string,
  context: Pick<Context, "repo" | "sha">
): Promise<[number, string][]> => {
  const mapping = await githubClient.loadNameMappingConfig(
    repoToken,
    context.repo.owner,
    context.repo.repo,
    configurationPath,
    context.sha
  );

  const bitrix24Ids = githubUsernames.map(
    (githubUsername) => {
    var bitrix24Id = mapping[githubUsername];
    return (bitrix24Id !== undefined)? bitrix24Id : [-1, githubUsername];
    }
  ) as [number, string][];

  return bitrix24Ids;
};

const quote_open = "------------------------------------------------------\n";
const quote_close = "\n------------------------------------------------------";

function fixBBCodeText(input: string) {
  const mask = [
    // 아래 코드가 들어갈 경우 문장이 깨지는 경우가 있어서 특수문자로 변환
    ["[", "［"], // [
    ["]", "］"], // ]
    ["#", "＃"] // #
  ];
  var output = input;
  mask.forEach(value => {
    output = output.split(value[0]).join(value[1]);
  });
  return output;
};

export const markdownToBitrix24Body = async (
  markdown: string,
  githubClient: typeof GithubRepositoryImpl,
  repoToken: string,
  configurationPath: string,
  context: Pick<Context, "repo" | "sha">
): Promise<string> => {
  var bitrix24body = markdown;

  // It may look different in bitrix24 because it is a simple character comparison, not a pattern check.
  const mask = [
    ["##### ", ""], // h5
    ["#### ", ""], // h4
    ["### ", ""], // h3
    ["## ", ""], // h2
    ["# ", ""], // h1
    ["***", ""], // line
    ["**", ""], // bold
    ["* ", "● "], // unordered list
    ["- [ ] ", "- □ "], // check box
//    ["_", ""], // italic
    ["*", ""], // italic
    ["> ", "| "], // blockquote
    // 아래 코드가 들어갈 경우 문장이 깨지는 경우가 있어서 특수문자로 변환
    ["[", "［"], // [
    ["]", "］"], // ]
    ["#", "＃"] // #
  ];

  mask.forEach(value => {
    bitrix24body = bitrix24body.split(value[0]).join(value[1]);
  });

  // to bitrix24ID on body
  const githubIds = pickupUsername(bitrix24body);
  if (githubIds.length > 0) {
    const bitrix24Ids = await convertToBitrix24Username(
      githubIds,
      githubClient,
      repoToken,
      configurationPath,
      context
    );
    githubIds.forEach((value, index) => {
      if (bitrix24Ids[index][0] >= 0)
        bitrix24body = bitrix24body.split("@" + value).join("[USER=" + bitrix24Ids[index][0] + "]" + bitrix24Ids[index][1] + "[/USER]");
    })
  }

  bitrix24body = quote_open + bitrix24body.trim() + quote_close;
//  bitrix24body = "[CODE]" + bitrix24body.trim() + "[/CODE]";
//  bitrix24body = "[QUOTE]" + bitrix24body.trim() + "[/QUOTE]";

  return bitrix24body;
};

// Pull Request
export const execPullRequestMention = async (
  payload: WebhookPayload,
  allInputs: AllInputs,
  githubClient: typeof GithubRepositoryImpl,
  bitrix24Client: typeof Bitrix24RepositoryImpl,
  context: Pick<Context, "repo" | "sha">
): Promise<void> => {
  const { repoToken, configurationPath } = allInputs;
  const pullRequestGithubUsername = payload.pull_request?.user?.login;
  console.log(pullRequestGithubUsername);
  if (!pullRequestGithubUsername) {
    throw new Error("Can not find pull requested user.");
  }

  const bitrix24Ids = await convertToBitrix24Username(
    [pullRequestGithubUsername],
    githubClient,
    repoToken,
    configurationPath,
    context
  );

  if (bitrix24Ids.length === 0) {
    return;
  }

  const action = payload.action;
  const title = fixBBCodeText(payload.pull_request?.title);
  const url = payload.pull_request?.html_url;
  const pull_request_body = payload.pull_request?.body as string;
  const changed_files = payload.pull_request?.changed_files as number;
  const commits = payload.pull_request?.commits as number;
  const merged = payload.pull_request?.merged as boolean;
  const pull_request_number = payload.pull_request?.number as number;
  // fixed for mobile app
  const prBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + pullRequestGithubUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";

  var message = "";
  var notiBitrix24Ids = [] as number[];
  var notiMessage = "";

  if (action === "opened" || action === "edited") {
    const pr_from = fixBBCodeText(payload.pull_request?.head?.ref as string);
    const pr_into = fixBBCodeText(payload.pull_request?.base?.ref as string);
    const body = (pull_request_body.length > 0) ? pull_request_body : "No description provided.";
    var pr_info = quote_open;
    pr_info += ((changed_files > 1) ? "Changed files" : "Changed file") + " : " + changed_files.toString();
    pr_info += ", ";
    pr_info += ((commits > 1) ? "Commits" : "Commit") + " : " + commits.toString();
    pr_info += quote_close;

    const githubIds = pickupUsername(body);
    if (githubIds.length > 0) {
      const bitrix24Ids = await convertToBitrix24Username(
        githubIds,
        githubClient,
        repoToken,
        configurationPath,
        context
      );
      githubIds.forEach((_, index) => {
        if (bitrix24Ids[index][0] >= 0)
          notiBitrix24Ids.push(bitrix24Ids[index][0]);
      })
    }

    const bitrix24Body = await markdownToBitrix24Body(
      body,
      githubClient,
      repoToken,
      configurationPath,
      context
    );
    message = `${prBitrix24UserId} has ${action} [B]PULL REQUEST[/B] into [I]${pr_into}[/I] from [I]${pr_from}[/I] [URL=${url}]${title}[/URL] ＃${pull_request_number}\n${pr_info}\n${bitrix24Body}\n${url}`;
    notiMessage = `[GITHUB] Mentioned you in PULL REQUEST ${url}`;
  }
  else if (action == "assigned" || action == "unassigned") {
    const targetGithubId = payload.assignee?.login as string;
    const bitrix24Ids = await convertToBitrix24Username(
      [targetGithubId],
      githubClient,
      repoToken,
      configurationPath,
      context
    );

    if (bitrix24Ids[0][0] >= 0)
      notiBitrix24Ids.push(bitrix24Ids[0][0])
    const bitrix24Body = quote_open + ((action == "assigned") ? "Added" : "Removed") + " : " + ((bitrix24Ids[0][0] < 0) ? "@" + targetGithubId : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]") + quote_close;
    message = `${prBitrix24UserId} has ${action} [B]PULL REQUEST[/B] [URL=${url}]${title}[/URL] ＃${pull_request_number}\n${bitrix24Body}\n${url}`;
    if (action == "assigned")
      notiMessage = `[GITHUB] Assigned you in PULL REQUEST ${url}`;
    else
      notiMessage = `[GITHUB] Unassigned you in PULL REQUEST ${url}`;
  }
  else if (action == "closed") {
    if (merged == true) { // the pull request was merged.
      const pr_from = fixBBCodeText(payload.pull_request?.head?.ref as string);
      const pr_into = fixBBCodeText(payload.pull_request?.base?.ref as string);
      var pr_info = quote_open;
      pr_info += ((changed_files > 1) ? "Changed files" : "Changed file") + " : " + changed_files.toString();
      pr_info += ", ";
      pr_info += ((commits > 1) ? "Commits" : "Commit") + " : " + commits.toString();
      pr_info += quote_close;
      message = `${prBitrix24UserId} has merged [B]PULL REQUEST[/B] into [I]${pr_into}[/I] from [I]${pr_from}[/I] [URL=${url}]${title}[/URL] ＃${pull_request_number}\n${pr_info}\n${url}`;
    }
    else { // the pull request was closed with unmerged commits.
      message = `${prBitrix24UserId} has ${action} [B]PULL REQUEST[/B] with unmerged commits [URL=${url}]${title}[/URL] ＃${pull_request_number}\n${url}`;
    }
  }
  else {
    message = `${prBitrix24UserId} has ${action} [B]PULL REQUEST[B] [URL=${url}]${title}[/URL] ＃${pull_request_number}\n${url}`;
  }

  console.log(message);
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, notiBitrix24Ids, notiMessage, { chatId, botName });
};

// PR comment mentions
export const execPrReviewRequestedCommentMention = async (
  payload: WebhookPayload,
  allInputs: AllInputs,
  githubClient: typeof GithubRepositoryImpl,
  bitrix24Client: typeof Bitrix24RepositoryImpl,
  context: Pick<Context, "repo" | "sha">
): Promise<void> => {
  const { repoToken, configurationPath } = allInputs;
  const commentGithubUsername = payload.comment?.user?.login as string;
  const pullRequestedGithubUsername = payload.issue?.user?.login as string;

  if (!commentGithubUsername) {
    throw new Error("Can not find comment user.");
  }
  if (!pullRequestedGithubUsername) {
    throw new Error("Can not find pull request user.");
  }

  const bitrix24Ids = await convertToBitrix24Username(
    [commentGithubUsername, pullRequestedGithubUsername],
    githubClient,
    repoToken,
    configurationPath,
    context
  );

  if (bitrix24Ids.length === 0) {
    return;
  }

  const action = payload.action as string;
  const pr_title = fixBBCodeText(payload.issue?.title as string);
  const pr_state = payload.issue?.state as string;
//  const comment_body = payload.comment?.body as string;
  var comment_body = payload.comment?.body as string;
  const comment_url = payload.comment?.html_url as string;
  const commentBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + commentGithubUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";
  const pullRequestedBitrix24UserId = (bitrix24Ids[1][0] < 0) ? "@" + pullRequestedGithubUsername : "[USER=" + bitrix24Ids[1][0] + "]" + bitrix24Ids[1][1] + "[/USER]";

  var notiBitrix24Ids = [] as number[];
  var notiMessage = "";

  // to bitrix24ID on comment
  const githubIds = pickupUsername(comment_body);
  if (githubIds.length > 0) {
    const bitrix24Ids = await convertToBitrix24Username(
      githubIds,
      githubClient,
      repoToken,
      configurationPath,
      context
    );
    githubIds.forEach((value, index) => {
      if (bitrix24Ids[index][0] >= 0) {
        comment_body = comment_body.split("@" + value).join("[USER=" + bitrix24Ids[index][0] + "]" + bitrix24Ids[index][1] + "[/USER]");
        notiBitrix24Ids.push(bitrix24Ids[index][0]);
      }
    })
  }

  // show comment text as quote text.
  const comment_as_quote = quote_open + comment_body.trim() + quote_close;

  const message = `${commentBitrix24UserId} has ${action} a [B]COMMENT[/B] on a ${pr_state} [B]PULL REQUEST[/B] ${pullRequestedBitrix24UserId} ${pr_title}\n${comment_as_quote}\n${comment_url}`;
  core.warning(message)

  notiMessage = `[GITHUB] Mentioned you in COMMENT on PULL REQUEST ${comment_url}`;
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, notiBitrix24Ids, notiMessage, { chatId, botName });
};

// Review Requested
export const execPrReviewRequestedMention = async (
  payload: WebhookPayload,
  allInputs: AllInputs,
  githubClient: typeof GithubRepositoryImpl,
  bitrix24Client: typeof Bitrix24RepositoryImpl,
  context: Pick<Context, "repo" | "sha">
): Promise<void> => {
  const { repoToken, configurationPath } = allInputs;
  const requestedGithubUsername =
    payload.requested_reviewer?.login || payload.requested_team?.name;
    const requestUsername = payload.sender?.login;

  if (!requestedGithubUsername) {
    throw new Error("Can not find review requested user.");
  }
  if (!requestUsername) {
    throw new Error("Can not find review request user.");
  }

  const bitrix24Ids = await convertToBitrix24Username(
    [requestedGithubUsername, requestUsername],
    githubClient,
    repoToken,
    configurationPath,
    context
  );

  if (bitrix24Ids.length === 0) {
    return;
  }

  const title = fixBBCodeText(payload.pull_request?.title);
  const url = payload.pull_request?.html_url;
  const requestedBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + requestedGithubUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";
  const requestBitrix24UserId = (bitrix24Ids[1][0] < 0) ? "@" + requestUsername : "[USER=" + bitrix24Ids[1][0] + "]" + bitrix24Ids[1][1] + "[/USER]";
  var notiBitrix24Ids = [] as number[];
  var notiMessage = "";

  if (bitrix24Ids[1][0] >= 0)
    notiBitrix24Ids.push(bitrix24Ids[1][0])

  const message = `${requestedBitrix24UserId} has been [B]REQUESTED to REVIEW[/B] [URL=${url}]${title}[/URL] by ${requestBitrix24UserId}\n${url}`;
  notiMessage = `[GITHUB] Requested to PULL REQUEST review by you ${url}`;
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, notiBitrix24Ids, notiMessage, { chatId, botName });
};

// pull_request_review
export const execPullRequestReviewMention = async (
  payload: WebhookPayload,
  allInputs: AllInputs,
  githubClient: typeof GithubRepositoryImpl,
  bitrix24Client: typeof Bitrix24RepositoryImpl,
  context: Pick<Context, "repo" | "sha">
): Promise<void> => {
  const { repoToken, configurationPath } = allInputs;
  const reviewerUsername = payload.review?.user?.login as string;
  const pullRequestUsername = payload.pull_request?.user?.login as string;

  if (!reviewerUsername) {
    throw new Error("Can not find review user.");
  }
  if (!pullRequestUsername) {
    throw new Error("Can not find pull request user.");
  }

  const bitrix24Ids = await convertToBitrix24Username(
    [reviewerUsername, pullRequestUsername],
    githubClient,
    repoToken,
    configurationPath,
    context
  );

  if (bitrix24Ids.length === 0) {
    return;
  }

  const action = payload.action as string;
  const title = fixBBCodeText(payload.pull_request?.title as string);
  const url = payload.pull_request?.html_url as string;
  const state = payload.pull_request?.state as string;
  const body = payload.review?.body as string;
  const review_url = payload.review?.html_url as string;
  const reviewerBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + reviewerUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";
  const pullRequestBitrix24UserId = (bitrix24Ids[1][0] < 0) ? "@" + pullRequestUsername : "[USER=" + bitrix24Ids[1][0] + "]" + bitrix24Ids[1][1] + "[/USER]";
  const cm_state = payload.review?.state as string;

  const bitrix24Body = await markdownToBitrix24Body(
    body,
    githubClient,
    repoToken,
    configurationPath,
    context
  );
  var notiBitrix24Ids = [] as number[];
  var notiMessage = "";

  var message = "";
  if (cm_state === "approved") {
    message = `${reviewerBitrix24UserId} has approved [B]PULL REQUEST[/B] [URL=${url}]${title}[/URL], which created by ${pullRequestBitrix24UserId}\n${review_url}`;
    if (bitrix24Ids[1][0] >= 0)
      notiBitrix24Ids.push(bitrix24Ids[1][0]);
    notiMessage = `[GITHUB] Approved PULL REQUEST ${review_url}`;
  }
  else {
    message = `${reviewerBitrix24UserId} has ${action} a [B]REVIEW[/B] on ${state} [B]PULL REQUEST[/B] [URL=${url}]${title}[/URL], which created by ${pullRequestBitrix24UserId}\n${bitrix24Body}\n${review_url}`;
  }
  
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, notiBitrix24Ids, notiMessage, { chatId, botName });
};

// pull_request_review_comment
export const execPullRequestReviewComment = async (
  payload: WebhookPayload,
  allInputs: AllInputs,
  githubClient: typeof GithubRepositoryImpl,
  bitrix24Client: typeof Bitrix24RepositoryImpl,
  context: Pick<Context, "repo" | "sha">
): Promise<void> => {
  const { repoToken, configurationPath } = allInputs;
  const reviewerCommentUsername = payload.comment?.user?.login as string;
  const pullRequestUsername = payload.pull_request?.user?.login as string;

  if (!reviewerCommentUsername) {
    throw new Error("Can not find review comment user.");
  }
  if (!pullRequestUsername) {
    throw new Error("Can not find pull request user.");
  }

  const bitrix24Ids = await convertToBitrix24Username(
    [reviewerCommentUsername, pullRequestUsername],
    githubClient,
    repoToken,
    configurationPath,
    context
  );

  if (bitrix24Ids.length === 0) {
    return;
  }

  const action = payload.action as string;
  const title = fixBBCodeText(payload.pull_request?.title as string);
  const url = payload.pull_request?.html_url as string;
  const state = payload.pull_request?.state as string;
  const body = payload.comment?.body as string;
  const changeFilePath = payload.comment?.path as string;
  const diffHunk = payload.comment?.diff_hunk as string;
  const comment_url = payload.comment?.html_url as string;
  const reviewCommentBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + reviewerCommentUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";
  const pullRequestBitrix24UserId = (bitrix24Ids[1][0] < 0) ? "@" + pullRequestUsername : "[USER=" + bitrix24Ids[1][0] + "]" + bitrix24Ids[1][1] + "[/USER]";
  var notiBitrix24Ids = [] as number[];
  var notiMessage = "";

  const message = `${reviewCommentBitrix24UserId} has ${action} a [B]COMMENT REVIEW[/B] on ${state} [B]PULL REQUEST[/B] [URL=${url}]${title}[/URL], which created by ${pullRequestBitrix24UserId}\n\n${quote_open}${changeFilePath}\n${diffHunk}${quote_close}\n${body}\n${comment_url}`;
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, notiBitrix24Ids, notiMessage, { chatId, botName });
};

// Issue metion
export const execIssueMention = async (
  payload: WebhookPayload,
  allInputs: AllInputs,
  githubClient: typeof GithubRepositoryImpl,
  bitrix24Client: typeof Bitrix24RepositoryImpl,
  context: Pick<Context, "repo" | "sha">
): Promise<void> => {
  const { repoToken, configurationPath } = allInputs;
//  const issueGithubUsername = payload.issue?.user?.login as string;
  const issueGithubUsername = payload.sender?.login as string;

  if (!{issueGithubUsername}) {
    throw new Error("Can not find issue user.");
  }

  const bitrix24Ids = await convertToBitrix24Username(
    [issueGithubUsername],
    githubClient,
    repoToken,
    configurationPath,
    context
  );

  if (bitrix24Ids.length === 0) {
    return;
  }

  const action = payload.action as string;
  const issue_title = fixBBCodeText(payload.issue?.title as string);
  // const issue_state = payload.issue?.state as string;
  const issue_body = payload.issue?.body as string;
  const issue_url = payload.issue?.html_url as string;
  const issueBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + issueGithubUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";
  var notiBitrix24Ids = [] as number[];
  var notiMessage = "";

  var message = "";

  if (action === "opened" || action === "edited") {
    const githubIds = pickupUsername(issue_body);
    if (githubIds.length > 0) {
      const bitrix24Ids = await convertToBitrix24Username(
        githubIds,
        githubClient,
        repoToken,
        configurationPath,
        context
      );
      githubIds.forEach((_, index) => {
        if (bitrix24Ids[index][0] >= 0)
          notiBitrix24Ids.push(bitrix24Ids[index][0]);
      })
    }
    const bitrix24Body = await markdownToBitrix24Body(
      issue_body,
      githubClient,
      repoToken,
      configurationPath,
      context
    );
    message = `${issueBitrix24UserId} has ${action} an [B]ISSUE[/B] [URL=${issue_url}]${issue_title}[/URL]\n${bitrix24Body}\n${issue_url}`;
    notiMessage = `[GITHUB] Mentioned you in ISSUE ${issue_url}`;
  }
  else if (action == "assigned" || action == "unassigned") {
    const targetGithubId = payload.assignee?.login as string;
    const bitrix24Ids = await convertToBitrix24Username(
      [targetGithubId],
      githubClient,
      repoToken,
      configurationPath,
      context
    );

    if (bitrix24Ids[0][0] >= 0)
      notiBitrix24Ids.push(bitrix24Ids[0][0])
    const bitrix24Body = quote_open + ((action == "assigned") ? "Added" : "Removed") + " : " + ((bitrix24Ids[0][0] < 0) ? "@" + targetGithubId : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]") + quote_close;
    message = `${issueBitrix24UserId} has ${action} an [B]ISSUE[/B] [URL=${issue_url}]${issue_title}[/URL]\n${bitrix24Body}\n${issue_url}`;
    if (action == "assigned")
      notiMessage = `[GITHUB] Assigned you in ISSUE ${issue_url}`;
    else
      notiMessage = `[GITHUB] Unassigned you in ISSUE ${issue_url}`;
  }
  else {
    message = `${issueBitrix24UserId} has ${action} an [B]ISSUE[/B] [URL=${issue_url}]${issue_title}[/URL]\n${issue_url}`;
  }

  core.warning(message)
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, notiBitrix24Ids, notiMessage, { chatId, botName });
};

// Issue comment mentions
export const execIssueCommentMention = async (
  payload: WebhookPayload,
  allInputs: AllInputs,
  githubClient: typeof GithubRepositoryImpl,
  bitrix24Client: typeof Bitrix24RepositoryImpl,
  context: Pick<Context, "repo" | "sha">
): Promise<void> => {
  const { repoToken, configurationPath } = allInputs;
  const commentGithubUsername = payload.comment?.user?.login as string;
  const issueGithubUsername = payload.issue?.user?.login as string;

  if (!{commentGithubUsername}) {
    throw new Error("Can not find comment user.");
  }
  if (!{issueGithubUsername}) {
    throw new Error("Can not find issue user.");
  }

  const bitrix24Ids = await convertToBitrix24Username(
    [commentGithubUsername, issueGithubUsername],
    githubClient,
    repoToken,
    configurationPath,
    context
  );

  if (bitrix24Ids.length === 0) {
    return;
  }

  const action = payload.action as string;
  const issue_title = fixBBCodeText(payload.issue?.title as string);
  const issue_state = payload.issue?.state as string;
//  const comment_body = payload.comment?.body as string;
  var comment_body = payload.comment?.body as string;
  const comment_url = payload.comment?.html_url as string;
  const commentBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + commentGithubUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";
  const issueBitrix24UserId = (bitrix24Ids[1][0] < 0) ? "@" + issueGithubUsername : "[USER=" + bitrix24Ids[1][0] + "]" + bitrix24Ids[1][1] + "[/USER]";

  var notiBitrix24Ids = [] as number[];
  var notiMessage = "";

  // to bitrix24ID on comment
  const githubIds = pickupUsername(comment_body);
  if (githubIds.length > 0) {
    const bitrix24Ids = await convertToBitrix24Username(
      githubIds,
      githubClient,
      repoToken,
      configurationPath,
      context
    );
    githubIds.forEach((value, index) => {
      if (bitrix24Ids[index][0] >= 0) {
        comment_body = comment_body.split("@" + value).join("[USER=" + bitrix24Ids[index][0] + "]" + bitrix24Ids[index][1] + "[/USER]");
        notiBitrix24Ids.push(bitrix24Ids[index][0]);
      }
    })
  }

  // show comment text as quote text.
  const comment_as_quote = quote_open + comment_body.trim() + quote_close;

  const message = `${commentBitrix24UserId} has ${action} a [B]COMMENT[/B] on a ${issue_state} [B]ISSUE[/B] ${issueBitrix24UserId} ${issue_title}\n${comment_as_quote}\n${comment_url}`;
  core.warning(message)

  notiMessage = `[GITHUB] Mentioned you in COMMENT on ISSUE ${comment_url}`;
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, notiBitrix24Ids, notiMessage, { chatId, botName });
};

const buildCurrentJobUrl = (runId: string) => {
  const { owner, repo } = context.repo;
  return `https://github.com/${owner}/${repo}/actions/runs/${runId}`;
};

export const execPostError = async (
  error: Error,
  allInputs: AllInputs,
  bitrix24Client: typeof Bitrix24RepositoryImpl
): Promise<void> => {
  const { runId } = allInputs;
  const currentJobUrl = runId ? buildCurrentJobUrl(runId) : undefined;
  const message = buildBitrix24ErrorMessage(error, currentJobUrl);

  var notiBitrix24Ids = [] as number[];
  var notiMessage = "";

  core.warning(message);

  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, notiBitrix24Ids, notiMessage, { chatId, botName });
};

const getAllInputs = (): AllInputs => {
  const bitrix24WebhookUrl = core.getInput("bitrix24-webhook-url", {
    required: true,
  });

  if (!bitrix24WebhookUrl) {
    core.setFailed("Error! Need to set `bitrix24-webhook-url`.");
  }

  const repoToken = core.getInput("repo-token", { required: true });
  if (!repoToken) {
    core.setFailed("Error! Need to set `repo-token`.");
  }

  const debugFlagString = core.getInput("debug-flag", { required: false})
  var debugFlag = false
  if (!debugFlagString) {
    core.warning("Set debugFlag as false by default.");
    debugFlag = false;
  }
  else if (debugFlagString === "true") {
    core.warning("Set debugFlag as true.");
    debugFlag = true;
  } else if (debugFlagString === "false")  {
    core.warning("Set debugFlag as false.");
    debugFlag = false;
  } else {
    core.setFailed("Unknown input. You should set true or false for a debug flag.")
  }
  // always set debugFlagString as true
  debugFlag = true

  const chatId = core.getInput("chat-id", { required: true });
  const botName = core.getInput("bot-name", { required: false });
  const configurationPath = core.getInput("configuration-path", {
    required: true,
  });
  const runId = core.getInput("run-id", { required: false });

  return {
    repoToken,
    configurationPath,
    bitrix24WebhookUrl,
    debugFlag,
    chatId,
    botName,
    runId,
  };
};

export const main = async (): Promise<void> => {
  const { payload } = context;
  const allInputs = getAllInputs();

  try {
    if (allInputs.debugFlag) {
      const message2 = `eventName is <${context.eventName}>.`;
      console.log(message2);
      const message3 = `action is <${context.action}>.`;
      console.log(message3);
      const message4 = `actor is <${context.actor}>.`;
      console.log(message4);
      const message5 = `issue is <${payload.issue?.pull_request}>.`;
      console.log(message5);
    }

    if (payload.action === "review_requested") {
      if (allInputs.debugFlag) core.warning("This action is a review requested.")
      await execPrReviewRequestedMention(
        payload,
        allInputs,
        GithubRepositoryImpl,
        Bitrix24RepositoryImpl,
        context
      );
      if (allInputs.debugFlag) {core.warning(JSON.stringify({ payload }));}
      return;
    }
    
    if (context.eventName === "pull_request") {
      if (allInputs.debugFlag) core.warning("This action is a pull request.")
      await execPullRequestMention(
        payload,
        allInputs,
        GithubRepositoryImpl,
        Bitrix24RepositoryImpl,
        context
      );
      if (allInputs.debugFlag) {core.warning(JSON.stringify({ payload }));}
      return;
    }

    if (context.eventName === "issue_comment") {
      if (payload.issue?.pull_request == undefined) {
        if (allInputs.debugFlag) core.warning("This comment is on an Issue.")
        await execIssueCommentMention(
          payload,
          allInputs,
          GithubRepositoryImpl,
          Bitrix24RepositoryImpl,
          context
        );
        if (allInputs.debugFlag) {core.warning(JSON.stringify({ payload }));}
        return;
      }
      else {
        if (allInputs.debugFlag) core.warning("This comment is on a pull request.")
        await execPrReviewRequestedCommentMention(
          payload,
          allInputs,
          GithubRepositoryImpl,
          Bitrix24RepositoryImpl,
          context
        );
        if (allInputs.debugFlag) {core.warning(JSON.stringify({ payload }));}
        return;
      }
      // throw new Error("Can not resolve this issue_comment.")
    }

    if (context.eventName === "issues") {
      await execIssueMention(
        payload,
        allInputs,
        GithubRepositoryImpl,
        Bitrix24RepositoryImpl,
        context
      );
      if (allInputs.debugFlag) {core.warning(JSON.stringify({ payload }));}
      return;
    }

    if (context.eventName === "pull_request_review") {
      await execPullRequestReviewMention(
        payload,
        allInputs,
        GithubRepositoryImpl,
        Bitrix24RepositoryImpl,
        context
      );
      if (allInputs.debugFlag) {core.warning(JSON.stringify({ payload }));}
      return;
    }

    if (context.eventName === "pull_request_review_comment") {
      await execPullRequestReviewComment(
        payload,
        allInputs,
        GithubRepositoryImpl,
        Bitrix24RepositoryImpl,
        context
      );
      if (allInputs.debugFlag) {core.warning(JSON.stringify({ payload }));}
      return;
    }

    // await execNormalMention(
    //   payload,
    //   allInputs,
    //   GithubRepositoryImpl,
    //   Bitrix24RepositoryImpl,
    //   context
    // );
    throw new Error("Unexpected event.");
  } catch (error) {
    await execPostError(error, allInputs, Bitrix24RepositoryImpl);
    core.warning(JSON.stringify({ payload }));
  }
};
