import assert from "node:assert/strict";
import type { ExternalPostDoc } from "@/lib/types";
import {
  buzzDraftTextHash,
  validateBuzzHarnessPacket,
  validateBlindReviewReceipt,
  blindReviewGateKeys,
  type BuzzHarnessPacket,
} from "@/lib/buzz-harness";

const now = new Date();
const isoNow = now.toISOString();
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const gate = (keys: string[]) => Object.fromEntries(keys.map((key) => [
  key,
  { pass: true as const, note: `For ${key}, the final copy was checked independently against this reader-visible condition, and the exact wording provides a distinct reason for PASS.` },
]));
const bakaKeys = [
  "instantComprehension",
  "recognizableSituation",
  "immediateReward",
  "lowCognitiveCost",
  "concreteSocialUse",
];
const resonanceKeys = [
  "ordinaryBaseline",
  "oneMeaningfulShift",
  "familiarFormatReturn",
  "counterexampleConsidered",
  "notSurfaceCopied",
];
const editorialKeys = [
  "A_entryAndUnderstanding",
  "B_specificCore",
  "C_readerReward",
  "D_shareOrConversationReason",
  "E_voiceAndNaturalness",
  "F_marketMechanismTransfer",
  "G_factsRightsAndSafety",
];

function fixture() {
  const postIds = ["post1", "post2", "post3", "post4", "post5", "post6"];
  const clusterIds = ["cluster1", "cluster2", "cluster3"];
  const keywordByCluster = ["train-platform", "family-chat", "work-handoff"];
  const laneByPost = ["Top", "Top", "Latest", "Latest", "Top", "Latest"] as const;
  const clusterForPost = [0, 0, 1, 1, 2, 2];
  const rates = [0.01, 0.02, 0.04, 0.06, 0.12, 0.22];
  const sourcePosts = new Map<string, ExternalPostDoc>();
  for (let index = 0; index < postIds.length; index += 1) {
    const id = postIds[index];
    sourcePosts.set(id, {
      id,
      platform: "x",
      platform_post_id: String(100000 + index),
      author_handle: `author_${index + 1}`,
      author_followers: 3000 + index * 700,
      text: `Observed post ${index + 1}: a concrete public situation with a specific action and a reader-visible outcome.`,
      created_at: ago(60 * 24 * (index + 2)),
      url: `https://x.com/author_${index + 1}/status/${100000 + index}`,
      metrics: {
        impressions: 1000 + index * 500,
        likes: 10 + index * 10,
        replies: index,
        reposts_or_rethreads: Math.max(0, index - 1),
        quotes: 0,
        link_clicks: null,
      },
      search_keyword: keywordByCluster[clusterForPost[index]],
      discovery_mode: laneByPost[index],
      fetched_at: ago(5 + index),
      engagement_rate: rates[index],
    });
  }

  const clusters = clusterIds.map((id, index) => {
    const ids = postIds.filter((_, postIndex) => clusterForPost[postIndex] === index);
    const modes = ids.map((postId) => sourcePosts.get(postId)!.discovery_mode);
    return {
      id,
      searchKeyword: keywordByCluster[index],
      query: `site:x.com public posts about ${keywordByCluster[index]} lang:ja`,
      acquisitionLane: modes.includes("Top") && modes.includes("Latest")
        ? "mixed" as const
        : modes[0]!,
      origin: index === 0 ? "seed_followup" as const : "blind_discovery" as const,
      sourcePostIds: ids,
      observation: `A separate discovery cluster about ${keywordByCluster[index]} with observable posts and a documented reason for looking at it.`,
    };
  });

  const observations = postIds.map((externalPostId, index) => ({
    externalPostId,
    clusterId: clusterIds[clusterForPost[index]],
    whyItMatters: `This post shows a specific audience situation and an observable reaction path in sample position ${index + 1}.`,
  }));

  const mechanisms = [
    {
      id: "mechanism-1",
      sourcePostIds: ["post1", "post2"],
      audienceSituation: "A reader encounters a small but recognizable interruption in a normal day.",
      ordinaryReaction: "The ordinary response is to keep scrolling or retell the incident literally.",
      attentionTrigger: "A highly specific detail changes the expected meaning of the situation.",
      immediateReward: "The reader recognizes the scene and notices one unexpected consequence.",
      socialUse: "A reader can send it to a friend who knows the same everyday situation.",
      counterexample: "A similar post with no specific detail does not create a comparable moment to retell.",
      transferableMechanism: "specific-scene-one-shift",
      transferContexts: ["A family coordination problem.", "A public-service interaction."],
      confidence: "medium" as const,
    },
    {
      id: "mechanism-2",
      sourcePostIds: ["post3", "post4"],
      audienceSituation: "A person has to interpret a short message with missing social context.",
      ordinaryReaction: "The ordinary response is to infer intent from the words alone.",
      attentionTrigger: "One small contextual clue changes the most plausible interpretation.",
      immediateReward: "The reader gets a more accurate reading of the interaction.",
      socialUse: "The post can be shared with someone who often misreads the same situation.",
      counterexample: "Without the surrounding action the phrase is ambiguous and no single reading is justified.",
      transferableMechanism: "context-reframes-short-message",
      transferContexts: ["English pragmatics.", "Japanese politeness."],
      confidence: "medium" as const,
    },
    {
      id: "mechanism-3",
      sourcePostIds: ["post5", "post6"],
      audienceSituation: "A group must decide who owns the next action when a process stalls.",
      ordinaryReaction: "The ordinary response is to send another reminder.",
      attentionTrigger: "The actual missing element is the next decision owner, not another update.",
      immediateReward: "The reader sees a concrete fix to a familiar coordination problem.",
      socialUse: "The post can be sent to a team that keeps repeating the same meeting.",
      counterexample: "No amount of assigning an owner fixes a genuine lack of authority or capacity.",
      transferableMechanism: "hidden-owner-of-next-action",
      transferContexts: ["Work handoffs.", "Household planning."],
      confidence: "medium" as const,
    },
  ];

  const candidateIdeas = [
    ["A commuter reaches the platform just as the doors close.", "The usual post would complain about missing the train.", "The platform announcement becomes the scene's unexpected punchline.", "A one-scene observational post keeps the moment familiar.", "The train was technically on time; my timing was the delayed part."],
    ["A shopper compares two nearly identical discount labels.", "The ordinary angle is another generic money-saving tip.", "The real surprise is that the smaller sticker creates more hesitation.", "A quick checkout vignette lets the reader see the choice.", "The coupon saved 30 yen and cost me four minutes of dignity."],
    ["A delivery note sits on the wrong apartment door.", "Most retellings would blame the courier immediately.", "One small detail makes the neighbour's explanation plausible.", "A concise mystery-with-a-reveal format carries the scene.", "The parcel was delivered correctly to the wrong version of my home."],
    ["A restaurant customer tries to order without blocking the queue.", "The standard advice is simply to decide before reaching the counter.", "The menu's layout, not the customer's indecision, creates the pause.", "A short menu-reading scene gives the reader an instant foothold.", "The queue moved faster when I stopped trying to read the menu like a contract."],
    ["Someone opens the washing machine and finds one lonely sock.", "A basic joke would declare the sock missing forever.", "The useful twist is that the pair was separated before the wash.", "A tiny household observation lands without a lecture.", "The washing machine has been blamed for a separation it did not cause."],
    ["An English learner reads quite good as faint praise.", "The obvious explanation is a direct dictionary translation.", "The surrounding speaker and context reverse the implied temperature.", "A short dialogue example shows the shift in meaning.", "The adjective stayed the same; the speaker's enthusiasm did not."],
    ["A group chat message receives a read receipt but no reply.", "The default interpretation is that everyone is ignoring the sender.", "The next message reveals that the group thought someone else owned the answer.", "A two-message exchange makes the misunderstanding visible.", "Six people saw the question and collectively appointed an imaginary seventh person."],
    ["A friend sends a single full stop after a long message.", "The easy reading is to label the punctuation angry.", "The sender's normal writing style is the missing context.", "A compact before-and-after chat example explains the ambiguity.", "Sometimes the punctuation is cold; sometimes that person just types like a printer."],
    ["A colleague says they will get back to you later.", "The standard post would translate later into never.", "A specific next action separates a real delay from a polite exit.", "A practical message example leaves room for uncertainty.", "Later is not a date, but it can still come with an owner and a next step."],
    ["A Japanese learner hears otsukaresama at the end of a meeting.", "A literal gloss makes it sound like praise for hard work.", "The phrase is doing social coordination rather than reporting fatigue.", "A short scene compares the phrase with its English alternatives.", "Nobody was congratulating the spreadsheet; they were closing the interaction."],
    ["A recurring meeting ends with a long list of action items.", "The familiar solution is to send everyone another reminder.", "The missing piece is who can make the next decision.", "A simple handoff example makes the hidden role obvious.", "The meeting did not need another summary; it needed one person allowed to decide."],
    ["Housemates keep finding the kitchen bin full.", "The ordinary advice is to make a chore rota.", "The real friction is that nobody knows when the bin is considered full.", "A household rule comparison makes the disagreement concrete.", "We did not need a rota; we needed a definition of full."],
    ["A project team has three copies of the final presentation.", "The generic fix is to name one file final-final.", "The deeper shift is to assign the person who accepts the final version.", "A file handoff scene gives the reader a recognisable work problem.", "The deck had four final versions because nobody owned the word final."],
    ["Two people keep missing each other's callback windows.", "The usual explanation is that both are busy.", "One shared time window is more useful than another vague promise.", "A tiny scheduling exchange demonstrates the alternative.", "We exchanged six missed calls to avoid agreeing on one ten-minute slot."],
    ["A shift ends with a note that says everything is handled.", "The default handover assumes the next person can infer the rest.", "The key is to name the unresolved exception, not narrate the whole shift.", "A before-and-after handover note makes the difference tangible.", "Everything was handled except the one thing the next shift needed to know."],
  ];
  const candidates = candidateIdeas.map((idea, index) => {
    const mechanism = mechanisms[index % mechanisms.length];
    return {
      id: `candidate-${index + 1}`,
      accountId: "account-1",
      mechanismId: mechanism.id,
      audienceMoment: idea[0],
      ordinaryIdea: idea[1],
      meaningfulShift: idea[2],
      familiarFormat: idea[3],
      hook: idea[4],
      immediateReward: `The reader can recognize the specific situation in example ${index + 1} without needing extra background.`,
      shareReason: `A reader can send this example to someone who has encountered the same situation.`,
      sourcePostIds: mechanism.sourcePostIds,
      surfaceCopyChecked: true as const,
    };
  });

  const draftText = "会議の最後に担当者だけ決めても、次に判断する人が決まっていないと、同じ話が次の会議に戻ってくる。";
  const packet: BuzzHarnessPacket = {
    schemaVersion: 1,
    runId: "buzz_run_test_0001",
    writerId: "writer-agent-alpha",
    model: "writer-model-alpha",
    createdAt: isoNow,
    initialSeed: "why some short public posts are shared by ordinary readers",
    accounts: [{
      accountId: "account-1",
      handle: "sample_handle",
      platform: "threads",
      characterVersion: 2,
      concept: "A focused account that observes specific work and everyday situations and explains them without generic advice.",
      capturedAt: isoNow,
      neededDraftCount: 1,
    }],
    searchClusters: clusters,
    observations,
    mechanisms,
    counterexamples: [
      {
        externalPostId: "post1",
        whyThisContradictsOrLimitsThePattern: "This low-reaction example uses a related everyday theme but does not contain a specific turning detail, limiting the claim that the topic alone explains response.",
      },
      {
        externalPostId: "post2",
        whyThisContradictsOrLimitsThePattern: "This second lower-quartile example has a familiar subject but little visible response, so topic similarity is not sufficient evidence.",
      },
    ],
    candidates,
    drafts: [{
      accountId: "account-1",
      characterVersion: 2,
      candidateId: "candidate-1",
      mechanismId: "mechanism-1",
      sourcePostIds: ["post1", "post2"],
      objective: "sharing",
      text: draftText,
      authoredAt: isoNow,
      bakaGate: gate(bakaKeys) as BuzzHarnessPacket["drafts"][number]["bakaGate"],
      resonanceGate: gate(resonanceKeys) as BuzzHarnessPacket["drafts"][number]["resonanceGate"],
      editorialGate: gate(editorialKeys) as BuzzHarnessPacket["drafts"][number]["editorialGate"],
    }],
  };

  const liveAccounts = new Map([["account-1", {
    id: "account-1",
    handle: "sample_handle",
    platform: "threads" as const,
    characterVersion: 2,
    concept: packet.accounts[0].concept,
    neededDraftCount: 1,
  }]]);

  return { packet, sourcePosts, liveAccounts };
}

function validate(testName: string, mutate?: (value: ReturnType<typeof fixture>) => void) {
  const value = fixture();
  mutate?.(value);
  return validateBuzzHarnessPacket({
    packet: value.packet,
    liveAccounts: value.liveAccounts,
    sourcePosts: value.sourcePosts,
    existingTextsByAccount: new Map([["account-1", []]]),
  });
}

function main() {
  const valid = validate("valid");
  assert.equal(valid.passed, true, valid.errors.join("\n"));
  assert.equal(valid.metrics.postsObserved, 6);
  assert.equal(valid.metrics.uniqueAuthors, 6);
  assert.equal(valid.metrics.mechanismFamilies, 3);

  const tooFewPosts = validate("too-few-posts", ({ packet }) => {
    packet.observations = packet.observations.slice(0, 5);
  });
  assert.equal(tooFewPosts.passed, false);
  assert.ok(tooFewPosts.errors.some((error) => /at least 6 actual posts/i.test(error)));

  const tooFewAuthors = validate("too-few-authors", ({ sourcePosts }) => {
    for (let index = 2; index < 6; index += 1) {
      const id = `post${index + 1}`;
      const post = sourcePosts.get(id)!;
      sourcePosts.set(id, { ...post, author_handle: "author_1" });
    }
  });
  assert.equal(tooFewAuthors.passed, false);
  assert.ok(tooFewAuthors.errors.some((error) => /4 distinct authors/i.test(error)));

  const statisticHook = validate("statistic-hook", ({ packet }) => {
    const draft = packet.drafts[0];
    draft.text = "調査では48%の人がそう答えた。これには理由がある。";
  });
  assert.equal(statisticHook.passed, false);
  assert.ok(statisticHook.errors.some((error) => /leads with statistics\/research/i.test(error)));

  const fakeCounterexample = validate("fake-counterexample", ({ packet }) => {
    packet.counterexamples = [
      { externalPostId: "post6", whyThisContradictsOrLimitsThePattern: "This is a deliberately weak counterexample selection from the highest measured reaction band and cannot represent low-response control evidence." },
      { externalPostId: "post5", whyThisContradictsOrLimitsThePattern: "This is a deliberately weak counterexample selection from the upper response band and cannot represent low-response control evidence." },
    ];
  });
  assert.equal(fakeCounterexample.passed, false);
  assert.ok(fakeCounterexample.errors.some((error) => /lowest quartile/i.test(error)));

  const staleCharacter = validate("stale-character", ({ liveAccounts }) => {
    liveAccounts.set("account-1", {
      ...liveAccounts.get("account-1")!,
      characterVersion: 1,
    });
  });
  assert.equal(staleCharacter.passed, false);
  assert.ok(staleCharacter.errors.some((error) => /characterVersion is stale/i.test(error)));

  const insufficientDivergence = validate("insufficient-divergence", ({ packet }) => {
    packet.candidates = packet.candidates.slice(0, 14);
  });
  assert.equal(insufficientDivergence.passed, false);
  assert.ok(insufficientDivergence.errors.some((error) => /at least 15 distinct candidate concepts/i.test(error)));

  const unverifiedSource = validate("unverified-source", ({ packet }) => {
    packet.drafts[0].sourcePostIds = ["not-in-db"];
  });
  assert.equal(unverifiedSource.passed, false);
  assert.ok(unverifiedSource.errors.some((error) => /source post/i.test(error)));

  const latestLaneLie = validate("latest-lane-lie", ({ sourcePosts }) => {
    for (const [id, post] of sourcePosts.entries()) {
      sourcePosts.set(id, { ...post, discovery_mode: "Top" });
    }
  });
  assert.equal(latestLaneLie.passed, false);
  assert.ok(latestLaneLie.errors.some((error) => /Top and Latest acquisition lanes/i.test(error)));

  const falseClusterLane = validate("false-cluster-lane", ({ packet }) => {
    packet.searchClusters[0].acquisitionLane = "Latest";
  });
  assert.equal(falseClusterLane.passed, false);
  assert.ok(falseClusterLane.errors.some((error) => /claims Latest but its canonical posts contain no Latest result/i.test(error)));

  const expectedTextHashes = [buzzDraftTextHash(fixture().packet.drafts[0].text)];
  const reviewChecks = () => Object.fromEntries(blindReviewGateKeys.map((key) => [
    key,
    { pass: true, note: `${key}: the reviewer independently inspected the exact displayed copy and found a concrete reason this condition passes.` },
  ]));
  const validBlindReview = validateBlindReviewReceipt({
    writerId: "writer-agent-alpha",
    writerModel: "writer-model-alpha",
    reviewerId: "reviewer-agent-beta",
    reviewerModel: "reviewer-model-beta",
    reviewerMode: "blind_copy_only",
    expectedTextHashes,
    reviews: [{
      textHash: expectedTextHashes[0],
      decision: "PASS",
      reviewedAt: isoNow,
      checks: reviewChecks(),
      note: "The reviewer checked the final copy alone and recorded why each mandatory gate passed.",
    }],
  });
  assert.deepEqual(validBlindReview, []);

  const rejectedGateReview = validateBlindReviewReceipt({
    writerId: "writer-agent-alpha",
    writerModel: "writer-model-alpha",
    reviewerId: "reviewer-agent-beta",
    reviewerModel: "reviewer-model-beta",
    reviewerMode: "blind_copy_only",
    expectedTextHashes,
    reviews: [{
      textHash: expectedTextHashes[0],
      decision: "REJECT",
      reviewedAt: isoNow,
      checks: {
        ...reviewChecks(),
        C_readerReward: { pass: false, note: "C_readerReward: the copy does not deliver a concrete reader reward without an explanation." },
      },
      note: "The final copy was rejected because one of the mandatory reader-side gates did not pass.",
    }],
  });
  assert.ok(rejectedGateReview.some((error) => /did not pass the independent blind review/i.test(error)));

  const sameReviewer = validateBlindReviewReceipt({
    writerId: "writer-agent-alpha",
    writerModel: "writer-model-alpha",
    reviewerId: "writer-agent-alpha",
    reviewerModel: "reviewer-model-beta",
    reviewerMode: "blind_copy_only",
    expectedTextHashes,
    reviews: [{
      textHash: expectedTextHashes[0],
      decision: "PASS",
      reviewedAt: isoNow,
      checks: reviewChecks(),
      note: "This text has a separate review note but uses the same writer identity.",
    }],
  });
  assert.ok(sameReviewer.some((error) => /identity must differ/i.test(error)));

  const sameModel = validateBlindReviewReceipt({
    writerId: "writer-agent-alpha",
    writerModel: "same-model",
    reviewerId: "reviewer-agent-beta",
    reviewerModel: "same-model",
    reviewerMode: "blind_copy_only",
    expectedTextHashes,
    reviews: [{
      textHash: expectedTextHashes[0],
      decision: "PASS",
      reviewedAt: isoNow,
      checks: reviewChecks(),
      note: "The reviewer identity differs, but the model is identical to the writing model.",
    }],
  });
  assert.ok(sameModel.some((error) => /model must differ/i.test(error)));

  const missingReview = validateBlindReviewReceipt({
    writerId: "writer-agent-alpha",
    writerModel: "writer-model-alpha",
    reviewerId: "reviewer-agent-beta",
    reviewerModel: "reviewer-model-beta",
    reviewerMode: "blind_copy_only",
    expectedTextHashes: [...expectedTextHashes, "a".repeat(64)],
    reviews: [{
      textHash: expectedTextHashes[0],
      decision: "PASS",
      reviewedAt: isoNow,
      checks: reviewChecks(),
      note: "A review was written for only one of the two final texts.",
    }],
  });
  assert.ok(missingReview.some((error) => /every unique final text/i.test(error)));

  console.log("Buzz Editorial Harness tests passed (14 scenarios).");
}

main();
