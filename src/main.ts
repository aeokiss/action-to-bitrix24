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
    ["> ", "| "] // blockquote
  ];

  mask.forEach(value => {
    bitrix24body = bitrix24body.split(value[0]).join(value[1]);
  })

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

  bitrix24body = "------------------------------------------------------\n" + bitrix24body.trim() + "\n------------------------------------------------------";
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
  const title = payload.pull_request?.title;
  const url = payload.pull_request?.html_url;
  const pull_request_body = payload.pull_request?.body as string;
  const changed_files = payload.pull_request?.changed_files as number;
  const commits = payload.pull_request?.commits as number;
  const merged = payload.pull_request?.merged as boolean;
  const pull_request_number = payload.pull_request?.number as number;
  // fixed for mobile app
  const prBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + pullRequestGithubUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";

  var message = "";
  if (action === "opened" || action === "edited") {
    const body = (pull_request_body.length > 0) ? pull_request_body : "No description provided.";
    var pr_info = "[QUOTE]";
    pr_info += ((changed_files > 1) ? "Changed files" : "Changed file") + " : " + changed_files.toString();
    pr_info += ", ";
    pr_info += ((commits > 1) ? "Commits" : "Commit") + " : " + commits.toString();
    pr_info += "[/QUOTE]";
    const bitrix24Body = await markdownToBitrix24Body(
      body,
      githubClient,
      repoToken,
      configurationPath,
      context
    );
    message = `[B]${prBitrix24UserId} has ${action} PULL REQUEST [URL=${url}]${title}[/URL] #${pull_request_number}[/B]\n${pr_info}\n${bitrix24Body}`;
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
    const bitrix24Body = "[QUOTE]" + ((action == "assigned") ? "Added" : "Removed") + " : " + ((bitrix24Ids[0][0] < 0) ? "@" + targetGithubId : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]") + "[/QUOTE]";
    message = `[B]${prBitrix24UserId} has ${action} PULL REQUEST [URL=${url}]${title}[/URL] #${pull_request_number}[/B]\n${bitrix24Body}`;
  }
  else if (action == "closed") {
    if (merged == true) { // the pull request was merged.
      const pr_from = payload.pull_request?.head?.ref as string;
      const pr_into = payload.pull_request?.base?.ref as string;
      var pr_info = "[QUOTE]";
      pr_info += ((changed_files > 1) ? "Changed files" : "Changed file") + " : " + changed_files.toString();
      pr_info += ", ";
      pr_info += ((commits > 1) ? "Commits" : "Commit") + " : " + commits.toString();
      pr_info += "[/QUOTE]";
      message = `[B]${prBitrix24UserId} has merged PULL REQUEST into [highlight]${pr_into}[/highlight] from [highlight]${pr_from}[/highlight] [URL=${url}]${title}[/URL] #${pull_request_number}[B]\n${pr_info}`;
    }
    else { // the pull request was closed with unmerged commits.
      message = `[B]${prBitrix24UserId} has ${action} PULL REQUEST with unmerged commits [URL=${url}]${title}[/URL] #${pull_request_number}[/B]`;
    }
  }
  else {
    message = `[B]${prBitrix24UserId} has ${action} PULL REQUEST [URL=${url}]${title}[/URL] #${pull_request_number}[/B]`;
  }

  console.log(message);
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, { chatId, botName });
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
  const pr_title = payload.issue?.title as string;
  const pr_state = payload.issue?.state as string;
//  const comment_body = payload.comment?.body as string;
  var comment_body = payload.comment?.body as string;
  const comment_url = payload.comment?.html_url as string;
  const commentBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + commentGithubUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";
  const pullRequestedBitrix24UserId = (bitrix24Ids[1][0] < 0) ? "@" + pullRequestedGithubUsername : "[USER=" + bitrix24Ids[1][0] + "]" + bitrix24Ids[1][1] + "[/USER]";

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
      if (bitrix24Ids[index][0] >= 0)
        comment_body = comment_body.split("@" + value).join("[USER=" + bitrix24Ids[index][0] + "]" + bitrix24Ids[index][1] + "[/USER]");
    })
  }

  // show comment text as quote text.
/*
  const comment_lines = comment_body.split("\n")
  var comment_as_quote = "";
  comment_lines.forEach(line => {
    core.warning(line)
    comment_as_quote += (">" + line);
  })
*/
  const comment_as_quote = "[QUOTE]" + comment_body + "/[QUOTE]";

  const message = `[B]${commentBitrix24UserId} has ${action} a COMMENT on a ${pr_state} PULL REQUEST ${pullRequestedBitrix24UserId} ${pr_title}[/B]\n${comment_as_quote}\n${comment_url}`;
  core.warning(message)
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, { chatId, botName });
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

  const title = payload.pull_request?.title;
  const url = payload.pull_request?.html_url;
  const requestedBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + requestedGithubUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";
  const requestBitrix24UserId = (bitrix24Ids[1][0] < 0) ? "@" + requestUsername : "[USER=" + bitrix24Ids[1][0] + "]" + bitrix24Ids[1][1] + "[/USER]";

  const message = `[B]${requestedBitrix24UserId} has been REQUESTED to REVIEW [URL=${url}]${title}[/URL] by ${requestBitrix24UserId}[/B]`;
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, { chatId, botName });
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
  const title = payload.pull_request?.title as string;
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

  const message = (cm_state === "approved")?
    `[B]${reviewerBitrix24UserId} has approved PULL REQUEST [URL=${url}]${title}[/URL], which created by ${pullRequestBitrix24UserId}[/B]\n${review_url}`
    :
    `[B]${reviewerBitrix24UserId} has ${action} a REVIEW on ${state} PULL REQUEST [URL=${url}]${title}[/URL], which created by ${pullRequestBitrix24UserId}[/B]\n${bitrix24Body}\n${review_url}`;
 
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, { chatId, botName });
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
  const title = payload.pull_request?.title as string;
  const url = payload.pull_request?.html_url as string;
  const state = payload.pull_request?.state as string;
  const body = payload.comment?.body as string;
  const changeFilePath = payload.comment?.path as string;
  const diffHunk = payload.comment?.diff_hunk as string;
  const comment_url = payload.comment?.html_url as string;
  const reviewCommentBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + reviewerCommentUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";
  const pullRequestBitrix24UserId = (bitrix24Ids[1][0] < 0) ? "@" + pullRequestUsername : "[USER=" + bitrix24Ids[1][0] + "]" + bitrix24Ids[1][1] + "[/USER]";

  const message = `[B]${reviewCommentBitrix24UserId} has ${action} a COMMENT REVIEW on ${state} PULL REQUEST [URL=${url}]${title}[/URL], which created by ${pullRequestBitrix24UserId}[/B]\n \n\`\`\`${changeFilePath}\n${diffHunk}\`\`\`\n${body}\n${comment_url}`;
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, { chatId, botName });
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
  const issue_title = payload.issue?.title as string;
  // const issue_state = payload.issue?.state as string;
  const issue_body = payload.issue?.body as string;
  const issue_url = payload.issue?.html_url as string;
  const issueBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + issueGithubUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";

  var message = "";

  if (action === "opened" || action === "edited") {
    const bitrix24Body = await markdownToBitrix24Body(
      issue_body,
      githubClient,
      repoToken,
      configurationPath,
      context
    );
    message = `[B]${issueBitrix24UserId} has ${action} an ISSUE [URL=${issue_url}]${issue_title}[/URL][/B]\n${bitrix24Body}`;
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
    const bitrix24Body = "[QUOTE]" + ((action == "assigned") ? "Added" : "Removed") + " : " + ((bitrix24Ids[0][0] < 0) ? "@" + targetGithubId : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]") + "[/QUOTE]";
    message = `[B]${issueBitrix24UserId} has ${action} an ISSUE [URL=${issue_url}]${issue_title}[/URL][/B]\n${bitrix24Body}`;
  }
  else {
    message = `[B]${issueBitrix24UserId} has ${action} an ISSUE [URL=${issue_url}]${issue_title}[/URL][/B]`;
  }

  core.warning(message)
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, { chatId, botName });
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
  const issue_title = payload.issue?.title as string;
  const issue_state = payload.issue?.state as string;
//  const comment_body = payload.comment?.body as string;
  var comment_body = payload.comment?.body as string;
  const comment_url = payload.comment?.html_url as string;
  const commentBitrix24UserId = (bitrix24Ids[0][0] < 0) ? "@" + commentGithubUsername : "[USER=" + bitrix24Ids[0][0] + "]" + bitrix24Ids[0][1] + "[/USER]";
  const issueBitrix24UserId = (bitrix24Ids[1][0] < 0) ? "@" + issueGithubUsername : "[USER=" + bitrix24Ids[1][0] + "]" + bitrix24Ids[1][1] + "[/USER]";

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
      if (bitrix24Ids[index][0] >= 0)
        comment_body = comment_body.split("@" + value).join("[USER=" + bitrix24Ids[index][0] + "]" + bitrix24Ids[index][1] + "[/USER]");
    })
  }

  // show comment text as quote text.
/*
  const comment_lines = comment_body.split("\n")
  var comment_as_quote = "";
  comment_lines.forEach(line => {
    core.warning(line)
    comment_as_quote += (">" + line);
  })
*/
  const comment_as_quote = "[QUOTE]" + comment_body + "[/QUOTE]";

  const message = `[B]${commentBitrix24UserId} has ${action} a COMMENT on a ${issue_state} ISSUE ${issueBitrix24UserId} ${issue_title}[/B]\n${comment_as_quote}\n${comment_url}`;
  core.warning(message)
  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, { chatId, botName });
};
/*
export const execNormalMention = async (
  payload: WebhookPayload,
  allInputs: AllInputs,
  githubClient: typeof GithubRepositoryImpl,
  bitrix24Client: typeof Bitrix24RepositoryImpl,
  context: Pick<Context, "repo" | "sha">
): Promise<void> => {
  const info = pickupInfoFromGithubPayload(payload);

  if (info.body === null) {
    return;
  }

  const githubUsernames = pickupUsername(info.body);
  if (githubUsernames.length === 0) {
    return;
  }

  const { repoToken, configurationPath } = allInputs;
  const bitrix24Ids = await convertToBitrix24Username(
    githubUsernames,
    githubClient,
    repoToken,
    configurationPath,
    context
  );

  if (bitrix24Ids.length === 0) {
    return;
  }

  const message = buildBitrix24PostMessage(
    bitrix24Ids,
    info.title,
    info.url,
    info.body,
    info.senderName
  );

  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, { chatId, botName });
};
*/
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

  core.warning(message);

  const { bitrix24WebhookUrl, chatId, botName } = allInputs;

  await bitrix24Client.postToBitrix24(bitrix24WebhookUrl, message, { chatId, botName });
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
