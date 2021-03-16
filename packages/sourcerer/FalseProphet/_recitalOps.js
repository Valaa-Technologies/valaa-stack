// @flow

import { Command, EventBase } from "~/raem/events";
import { getActionFromPassage, Story } from "~/raem/redux/Bard";

import { initializeAspects } from "~/sourcerer/tools/EventAspects";
import SOURCERER_EVENT_VERSION from "~/sourcerer/EVENT_VERSION";

import { dumpObject, generateDispatchEventPath, isPromise } from "~/tools";

import FalseProphet from "./FalseProphet";
import FalseProphetConnection from "./FalseProphetConnection";
import StoryRecital from "./StoryRecital";

import { Prophecy, _confirmVenueCommand, _rewriteVenueCommand } from "./_prophecyOps";
import { _validateAspects } from "./_aspectOps";

/**
 * Dispatches given event to the corpus and get the corresponding
 * story. This event can be a downstream-bound truth, a fresh
 * upstream-bound command, narration request for cached commands or
 * a reformation of an existing prophecy.
 * Returns a story which contains the action itself and the corpus
 * state before and after the action.
 *
 * @param  {type} event     an command to go upstream
 * @returns {type}          description
 */
export function _composeEventIntoRecitalStory (
    falseProphet: FalseProphet, event: EventBase, dispatchDescription: string, options: Object = {},
) {
  const { transactionState, truthConnection } = options;
  if (!event.aspects) initializeAspects(event, { version: SOURCERER_EVENT_VERSION });

  const transactor = event.meta && event.meta.transactor;
  const operation = event.meta && event.meta.operation;

  let progress;

  const previousState = falseProphet._corpus.getState();
  let story, dump;
  if (transactionState) {
    story = options.transactionState._tryFastForwardOnCorpus(falseProphet._corpus);
    if (story) {
      falseProphet.warnEvent(2, () => [
        `Committing a main line transaction '${transactionState.name}' as fast-forwarded event:`,
        "\n\tevent:", ...dumpObject(event),
        ...dumpObject(story),
      ]);
    } else {
      dump = true;
      falseProphet.warnEvent(2, () => [
        `Rebasing a branched transaction '${transactionState.name}' as a regular new event:`,
        "\n\tevent:", ...dumpObject(event),
      ]);
    }
  }
  if (!story) {
    if (!truthConnection) {
      const dispatchPath = generateDispatchEventPath(transactor, "compose");
      if (dispatchPath) {
        progress = operation.getProgressEvent("compose");
        if (!transactor.dispatchAndDefaultActEvent(progress, { dispatchPath })) {
          story = null;
        }
      }
    } else if (truthConnection.isFrozenConnection() || truthConnection.isInvalidated()) {
      story = null;
    }
    if (story === undefined) {
      story = falseProphet._corpus.dispatch(event, dispatchDescription);
      if (truthConnection
          && !_validateAspects(
              truthConnection, event, previousState, falseProphet._corpus.getState(),
              options.previousEvent)) {
        falseProphet.recreateCorpus(previousState);
        story = null;
      }
      if (dump) {
        falseProphet.warnEvent(1, () => [
          `Rebased a branched transaction '${transactionState.name}' as a regular new event:`,
          "\n\tstory:", ...dumpObject(story),
        ]);
      }
    }
  }
  if (story) {
    // story.timed = options.timed;
    if (dispatchDescription.slice(0, 8) === "prophecy") story.isProphecy = true;
    if (options.truthConnection) story.isTruth = true;
    if (operation) operation._prophecy = story;
    // story.id = story.aspects.command.id; TODO(iridian): what was this?
    const dispatchPath = generateDispatchEventPath(transactor, "profess");
    if (dispatchPath) {
      if (!progress) progress = operation.getProgressEvent();
      progress.type = "profess";
      progress.prophecy = story;
      if (!transactor.dispatchAndDefaultActEvent(progress, { dispatchPath })) {
        falseProphet.recreateCorpus(previousState);
        progress.prophecy = story = null;
      }
    }
    if (story) {
      falseProphet._canonicalRecital.addStory(story);
      if (operation && operation._progress) operation._progress.isSchismatic = false;
      return story;
    }
  }
  return undefined;
}

export function _purgeLatestRecitedStory (falseProphet: FalseProphet, heresy: EventBase, require) {
  const latestStory = falseProphet._canonicalRecital.getLast();
  if (!latestStory
      || (((latestStory.aspects || {}).command || {}).id
          !== ((heresy.aspects || {}).command || {}).id)) {
    if (!require && !falseProphet._canonicalRecital.getStoryBy(heresy.aspects.command.id)) {
      return false; // Already purged.
    }
    throw new Error(`_purgeLatestRecitedStory.heresy.aspects.command.id ('${
        heresy.aspects.command.id}') prophecy was found in recital but not as the latest story ('${
        latestStory.aspects.command.id}')`);
  }
  const transactor = latestStory.meta.transactor;
  const dispatchPath = generateDispatchEventPath(transactor, "purge");
  if (dispatchPath) {
    transactor.dispatchAndDefaultActEvent(
        latestStory.meta.operation.getProgressEvent("purge"), { dispatchPath });
  }
  falseProphet._canonicalRecital.removeStory(latestStory);
  falseProphet.recreateCorpus(latestStory.previousState);
  return new StoryRecital(latestStory);
}

export function _confirmRecitalStories (instigatorConnection: FalseProphetConnection,
    confirmations: Command[]) {
  const falseProphet = instigatorConnection.getFalseProphet();
  for (const confirmation of confirmations) {
    const story = falseProphet._canonicalRecital.getStoryBy(confirmation.aspects.command.id);
    if (story) {
      if (!story.isProphecy) story.isTruth = true;
      else _confirmVenueCommand(instigatorConnection, story, confirmation);
    } else {
      instigatorConnection.warnEvent(`_confirmRecitalStories encountered a command '${
            confirmation.aspects.command.id}' with no corresponding story, with:`,
          "\n\tcurrent command:", ...dumpObject(confirmation),
          "\n\tconfirmed commands:", ...dumpObject(confirmations),
          "\n\tprimary recital:", ...dumpObject(falseProphet._canonicalRecital));
    }
  }
}

export function _elaborateRecital (instigatorConnection: FalseProphetConnection,
    newEvents: Command[], type: string, schismaticCommands: ?Command[], latestTruth) {
  const elaboration = {
    instigatorConnection, newEvents, type, schismaticCommands, latestTruth,
    falseProphet: instigatorConnection.getFalseProphet(),
    instigatorChronicleURI: instigatorConnection.getChronicleURI(),
    newEventIndex: 0,
    newRecitalStories: [],
    schismaticRecital: undefined,
    affectedChronicles: undefined,
  };
  if (schismaticCommands && schismaticCommands.length) {
    instigatorConnection.setInvalidated(false);
    instigatorConnection.setIsFrozen(false);
  }
  const plog2 = elaboration.plog2 = elaboration.falseProphet.opLog(2, "elaboration");
  plog2 && plog2.opEvent("",
      `Elaborating recital (${
          instigatorConnection._dumpEventIds(newEvents)}, ${type}, ${
          instigatorConnection._dumpEventIds(schismaticCommands)})`, elaboration);

  newEvents.forEach((event, index) => {
    newEvents[index] = {
      ...event, meta: { ...(event.meta || {}), chronicleURI: elaboration.instigatorChronicleURI },
    };
  });

  let revisioning;
  if (schismaticCommands) {
    revisioning = _launchRevisioning(elaboration);
    plog2 && plog2.opEvent("revisioning",
        `Revising schismatic recital: ${elaboration.schismaticRecital.size}`, { revisioning });
  }
  let nextSchism;
  while (true) { // eslint-disable-line
    // Alternate between reciting new events and reviewing schismatic
    // stories, always preferring new events unless a new event is part
    // of an existing schismatic story. In that case review, repeat,
    // revise and recite or remove schismatic stories until the schism
    // blocking new events is resolved. Then go back to dispatching new
    // events.
    if (!nextSchism) nextSchism = _extendRecitalUntilNextSchism(elaboration);

    // break if not in a revisioning (both undefined) or if recital
    // ring end has been reached
    if (revisioning === elaboration.schismaticRecital) break;

    let progress = revisioning.meta.operation._progress;

    if (!progress) progress = _reviewForeignStory(elaboration, revisioning, nextSchism);

    const recomposition = (!progress || (progress.isRevisable !== false))
        && _recomposeSchismaticStory(elaboration.falseProphet, revisioning);
    if (recomposition) {
      progress = recomposition.meta.operation._progress;
      if (!progress || !progress.isSchismatic) {
        elaboration.newRecitalStories.push(recomposition);
      } else {
        const revisedReformee = instigatorConnection
            ._reviewRecomposedSchism(revisioning, recomposition);
        if (revisedReformee) {
          elaboration.newRecitalStories.push(revisedReformee);
        } else {
          _purgeLatestRecitedStory(elaboration.falseProphet, recomposition);
        }
      }
    }

    if (revisioning === nextSchism) {
      nextSchism = undefined;
      progress = revisioning.meta.operation._progress;
      const schismCause = newEvents[elaboration.newEventIndex];
      if (!progress || !progress.isSchismatic) {
        _rewriteVenueCommand(instigatorConnection, revisioning, schismCause);
      } else {
        _rewriteRevisionBreachVenueCommand(
              elaboration, progress, revisioning, recomposition, schismCause);
      }
      ++elaboration.newEventIndex;
    }

    if (progress) {
      // Mark all of the reviewed prophecy's chronicles as
      // schismatic/revised depending on whether a schism remains
      // after revision.
      // If schismatic all subsequent commands on these chronicles
      // need to be fully, possibly asynchronously, even interactively
      // revised as they're likely to depend on the first schismatic
      // change.
      for (const chronicleURI of Object.keys((revisioning.meta || {}).chronicles || {})) {
        const affectedChronicle = elaboration.affectedChronicles[chronicleURI]
            || (elaboration.affectedChronicles[chronicleURI] = {});
        if (!progress.isSchismatic) continue;
        if (!affectedChronicle.isSchismatic) {
          affectedChronicle.isSchismatic = true;
          affectedChronicle.initialSchism = revisioning;
          affectedChronicle.propheciesToRevise = [];
        }
        affectedChronicle.propheciesToRevise.push(revisioning);
      }
    }

    // Remove successfully repeated/reviewed stories from the schismatic recital.
    revisioning = !progress || !progress.isSchismatic
        ? elaboration.schismaticRecital.removeStory(revisioning) // Also advances to next
        : revisioning.next; // Keep it as schismatic, just advance to next
  }

  if (revisioning && _finalizeRevisioning(elaboration)) {
    elaboration.schismaticRecital = undefined;
  }

  elaboration.falseProphet
      ._reciteStoriesToFollowers(elaboration.newRecitalStories, elaboration.schismaticRecital);
  elaboration.isComplete = true;

  instigatorConnection._checkForFreezeAndNotify(plog2, newEvents);
  _confirmLeadingTruthsToFollowers(elaboration.falseProphet);

  plog2 && plog2.opEvent("done",
      "Elaboration done");
}

function _launchRevisioning (elaboration: Object): Story {
  let initialSchism, schismaticRecitalName;
  const prophet = elaboration.falseProphet;
  for (const command of elaboration.schismaticCommands) {
    const prophecy = prophet._canonicalRecital.getStoryBy(command.aspects.command.id);
    if (!prophecy) continue;
    if (!initialSchism) {
      initialSchism = prophecy;
      schismaticRecitalName = `schismatic:${initialSchism.aspects.command.id}`;
    }
    const operation = (prophecy.meta || {}).operation;
    if (!operation) continue;

    const progress = operation.getProgressEvent("schism");
    progress.schismaticCommand = command;
    if (progress.isSchismatic === true) {
      // Mark already schismatic prophecies as decidedly non-revisable
      progress.isRevisable = false;
    } else {
      // Mark dependent prophecies to become by-default-action
      // schismatic and non-revisable.
      progress.isSchismatic = undefined;
      if (progress.isRevisable !== true) progress.isRevisable = undefined;
    }
    if (progress.isReformable !== false) progress.isReformable = undefined;
    if (!progress.message) {
      progress.message = `revisioning due to ${
        initialSchism === prophecy ? "own schism" : schismaticRecitalName}`;
    }
    const transactor = prophecy.meta.transactor;
    if (transactor) {
      transactor.dispatchAndDefaultActEvent(progress);
    } else {
      operation.defaultActEvent(progress);
    }
  }
  if (!initialSchism) return undefined;

  prophet._canonicalRecital.extractStoryChain(initialSchism);
  const purgedState = initialSchism.previousState;
  prophet.recreateCorpus(purgedState);
  elaboration.schismaticRecital = new StoryRecital(initialSchism, schismaticRecitalName);
  elaboration.affectedChronicles = { [elaboration.instigatorChronicleURI]: {} };
  return elaboration.schismaticRecital.getFirst();
}

function _extendRecitalUntilNextSchism (elaboration) {
  const newEvents = elaboration.newEvents;
  for (; elaboration.newEventIndex !== newEvents.length; ++elaboration.newEventIndex) {
    const newEvent = newEvents[elaboration.newEventIndex];
    const nextSchism = elaboration.schismaticRecital
        && elaboration.schismaticRecital.getStoryBy(newEvent.aspects.command.id);
    if (nextSchism) { // This new event revises an existing schism.
      if (nextSchism.meta.operation._progress) {
        nextSchism.meta.operation._progress.isRevisable = true;
      }
      return nextSchism; // Switch to schism review phase.
    }
    const story = _composeEventIntoRecitalStory(elaboration.falseProphet, newEvent,
        elaboration.type, (elaboration.type !== "receive_truth") ? {} : {
          truthConnection: elaboration.instigatorConnection,
          previousEvent: newEvents[elaboration.newEventIndex - 1] || elaboration.latestTruth,
        });
    if (story) elaboration.newRecitalStories.push(story);
  }
  return undefined;
}

function _reviewForeignStory (elaboration, revisioning, nextSchism) { // eslint-disable-line
  const meta = revisioning.meta;
  // No progression tracking for pre-existing truths needed
  if (!revisioning.isProphecy || !meta) return undefined;
  const chronicleURIs = meta.chronicles ? Object.keys(meta.chronicles)
      : meta.chronicleURI ? [meta.chronicleURI]
      : undefined;
  if (!chronicleURIs) return undefined;
  const progress = meta.operation.getProgressEvent();
  for (const chronicleURI of chronicleURIs) {
    const affectedChronicle = elaboration.affectedChronicles[chronicleURI];
    if (!affectedChronicle) continue;
    if (chronicleURI === elaboration.instigatorChronicleURI) {
      if (revisioning === nextSchism) continue;
      progress.message = `schism created by a prophecy reordering revisioning`;
      progress.reorderingSchism = nextSchism;
    } else if (affectedChronicle.isSchismatic) {
      if (progress.type !== "reform") {
        progress.type = "reform";
        progress.message = `a prophecy chronicle contains a non-revised earlier schism`;
        progress.isSchismatic = true;
        progress.isReformable = progress.isRevisable;
        progress.isRevisable = false;
      }
    } else continue;
    (progress.schismaticChronicles || (progress.schismaticChronicles = []))
        .push(chronicleURI);
  }
  return progress;
}

export function _recomposeSchismaticStory (falseProphet: FalseProphet, story: Prophecy) {
  const event = getActionFromPassage(story);
  const transactor = event.meta.transactor;
  const operation = event.meta.operation;
  const progress = operation._progress;
  let recomposedStory;
  const composeDescription = !progress ? "story-recompose"
      : !progress.isSchismatic ? "prophecy-review"
      : "prophecy-schism-revise";
  try {
    return _composeEventIntoRecitalStory(falseProphet, event, composeDescription);
    /*
    const dispatchPath = generateDispatchEventPath(transactor, "review");
    if (dispatchPath) {
      progress = operation.getProgressEvent("review");
      progress.prophecy = recomposedStory;
      progress.oldProphecy = story;
      if (!transactor.dispatchAndDefaultActEvent(progress, { dispatchPath })) {
        _purgeLatestRecitedStory(falseProphet, recomposedStory);
        return undefined;
      }
    }
    */
  } catch (error) {
    const commandId = story.aspects.command.id;
    const wrappedError = falseProphet.wrapErrorEvent(error, 1,
        new Error(`_recomposeSchismaticStory.${composeDescription}.dispatch(${commandId}) ${
          (composeDescription !== "story-recompose")
              ? "recomposition schism: failed to reduce the purged command against fresh corpus"
              : "INTERNAL ERROR: non-purged event recomposition resulted in an error"}
        }`),
        "\n\tevent:", ...dumpObject(event),
        "\n\tstory:", ...dumpObject(story));
    if (recomposedStory) {
      _purgeLatestRecitedStory(falseProphet, recomposedStory, false);
    } else if (progress) {
      progress.type = "reform";
    }
    const errorEvent = operation.getProgressErrorEvent("compose", wrappedError, {
      prophecy: story,
      composeDescription,
      message: `a reduction schism found during ${composeDescription
          } of a story of a purged command; ${error.message}`,
    }, {
      isRevisable: true,
    });
    if (transactor && !transactor.dispatchAndDefaultActEvent(errorEvent)) return undefined;
    throw wrappedError;
  }
}

function _rewriteRevisionBreachVenueCommand (
    elaboration: Object, progress, schism, recomposition, schismCausingNewEvent) {
  const error = elaboration.instigatorConnection.wrapErrorEvent(
      new Error(`REVISION BREACH ERROR: a schismatic prophecy with a confirming incoming truth${
        ""} remains schismatic after recomposition.`),
      1,
      new Error("_rewriteRevisionBreachVenueCommand"),
      "\n\tPurging the origin prophecy and recomposing the incoming truth as standalone.",
      "\n\tschism description:", progress.message,
      "\n\tschism:", ...dumpObject(schism),
      "\n\trecomposition:", ...dumpObject(recomposition),
      "\n\tschism progress:", ...dumpObject(progress),
      "\n\tschism cause event:", ...dumpObject(schismCausingNewEvent),
  );
  Object.assign(progress, {
    error, errorOrigin: "breach",
    isRevisable: false, isReformable: false, isRefabricateable: false,
    message: error.message,
  });
  elaboration.instigatorConnection.outputErrorEvent(error,
      "Exception caught during schismatic command rewrite");
  if (schism.meta.operation) schism.meta.operation.purge("revision breach");
  progress.type = "breach";
  elaboration.newRecitalStories.push(
      _composeEventIntoRecitalStory(
          elaboration.falseProphet, schismCausingNewEvent, `${elaboration.type}-breach`));
  return progress;
}

function _finalizeRevisioning (elaboration: Object) {
  // Schismatic recital is now considered to be heretic recital events.
  // Reform or purge each of the heretic stories.
  const hereticRecital = elaboration.schismaticRecital;
  if (!hereticRecital || (hereticRecital.getFirst() === hereticRecital)) return true;
  elaboration.plog2 && elaboration.plog2.opEvent("revisioning.finalize",
      `Reforming ${hereticRecital.size} events onwards from elaborated event #${
          elaboration.newEventIndex}`);
  let purgedHeresies;
  for (let heresy = hereticRecital.getFirst(); heresy !== hereticRecital;) {
    const operation = (heresy.meta || {}).operation;
    if (!operation) {
      // not originating from our downstream during this execution session; someone else's problem.
      continue;
    }
    const revisedHeresy = operation.launchPartialReform(elaboration);
    if (revisedHeresy && !isPromise(revisedHeresy)) {
      // add synchronous reform as part of the current revisioning
      elaboration.newRecitalStories.push(revisedHeresy);
      heresy = hereticRecital.removeStory(heresy);
      continue;
    }
    if (!revisedHeresy) { // was immediately purged as heresy
      (purgedHeresies || (purgedHeresies = [])).push(heresy);
    } else { // delayed full reform
      revisedHeresy.then(reformedHeresy => {
        if (reformedHeresy) {
          elaboration.falseProphet._reciteStoriesToFollowers([reformedHeresy]);
        }
      });
    }
    heresy = heresy.next;
  }
  if (purgedHeresies) {
    elaboration.instigatorConnection.errorEvent(1, () => [
      "\n\nHERESIES PURGED:", ...purgedHeresies.map(h => {
        const result = { command: ({ ...getActionFromPassage(h) }) };
        result.chronicles = result.command.meta.chronicles;
        delete result.command.meta;
        return result;
      }),
      "\n\tby revisioning:", ...dumpObject(elaboration),
      "\n\tof heretic recital:", ...dumpObject(hereticRecital),
      "\n\telaboration new events:", ...dumpObject(elaboration.newEvents),
      "\n\telaboration schismatic commands:", ...dumpObject(elaboration.schismaticCommands),
    ]);
  }
  return hereticRecital.getFirst() === hereticRecital;
}

export function _reciteStoriesToFollowers (falseProphet: FalseProphet, stories: Story[],
    purgedRecital: ?StoryRecital, plog) {
  plog && plog.v2 && plog.opEvent(falseProphet, "recite",
      `_reciteStoriesToFollowers(${stories.length}, ${purgedRecital ? purgedRecital.size : 0})`);
  falseProphet._followers.forEach((discourse, follower) => {
    let reactions;
    try {
      reactions = discourse.receiveCommands(stories, purgedRecital);
      if (reactions) {
        for (let i = 0; i !== stories.length; ++i) {
          const story = stories[i];
          const operation = story.meta.operation;
          if (!operation) continue;
          operation.story = story;
          (operation._reactions || (operation._reactions = new Map()))
              .set(follower, reactions[i]);
        }
      }
    } catch (error) {
      falseProphet.outputErrorEvent(
          falseProphet.wrapErrorEvent(error, 2,
              "_reciteStoriesToFollowers",
              "\n\tstories:", ...dumpObject(stories),
              "\n\treactions:", ...dumpObject(reactions),
              "\n\ttarget discourse:", ...dumpObject(discourse),
          ),
          "Exception caught when delivering stories to a follower");
    }
  });
  for (const story of stories) {
    const operation = story.meta.operation;
    if (!operation) continue;
    if (!operation._reactions) operation._reactions = null;
    if (operation._resolveReactions) operation._resolveReactions();
  }
}

// Notify followers about the stories that have been confirmed as
// permanent truths in chronological order, ie. all stories at the
// front of the recital marked as isTruth and which thus can no
// longer be affected by any future purges and revisionings.
export function _confirmLeadingTruthsToFollowers (falseProphet: FalseProphet, plog) {
  const truths = [];
  for (let story = falseProphet._canonicalRecital.getFirst(); story.isTruth; story = story.next) {
    truths.push(story);
  }
  plog && plog.v2 && plog.opEvent(falseProphet, "confirm",
      `_confirmLeadingTruthsToFollowers(${truths.length})`);
  if (!truths.length) return;
  falseProphet._canonicalRecital.extractStoryChain(truths[0], truths[truths.length - 1].next);
  falseProphet._followers.forEach(discourse => {
    try {
      discourse.receiveTruths(truths);
    } catch (error) {
      falseProphet.outputErrorEvent(
          falseProphet.wrapErrorEvent(error, 2,
              "_confirmLeadingTruthsToFollowers",
              "\n\tstories:", ...dumpObject(truths),
              "\n\ttarget discourse:", ...dumpObject(discourse),
          ),
          "Exception caught during follower truth confirmation");
    }
  });
}
