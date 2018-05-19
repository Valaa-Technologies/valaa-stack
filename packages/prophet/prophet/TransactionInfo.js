import { createPassageFromAction, createUniversalizableCommand, getActionFromPassage }
    from "~/raem/redux/Bard";

import Command, { transacted } from "~/raem/command";
import type { Corpus } from "~/raem/Corpus";

import { ClaimResult } from "~/prophet/api/Prophet";
import Prophecy from "~/prophet/api/Prophecy";
import type { Transaction } from "~/prophet/api/Transaction";

import { dumpObject, invariantify } from "~/tools";

let transactionCounter = 0;

export default class TransactionInfo {
  constructor (transaction: Transaction, customCommand: Object) {
    this.transaction = transaction;
    this.stateBefore = transaction.getState();
    this.stateAfter = null;
    // restrictedActions is set to null when the transaction has been committed.
    this.restrictedActions = [];
    this.transacted = transacted({ actions: [] });
    this.storyPassages = [];
    this.universalPartitions = {};
    this.customCommand = customCommand;
    this.resultPromises = [];
    transaction.transactionDepth = 1;
    transaction.corpus = transaction.corpus.fork();
    transactionCounter += 1;
    this.transactionClaimDescription = `tx#${transactionCounter} sub-claim`;
    transaction.corpus.setName(
        `${transaction.corpus.getName()}/Transaction#${transactionCounter}`);
  }

  isCommittable () {
    return this.restrictedActions;
  }

  isFastForwardFrom (previousState: Object) {
    return this.stateBefore === previousState;
  }

  createNestedTransaction (transaction: Transaction, customCommand?: Object) {
    const nestedTransaction = Object.create(transaction);
    nestedTransaction.transactionDepth = transaction.transactionDepth + 1;
    // Custom command alters the custom command of the whole transaction.
    this.setCustomCommand(customCommand, "creating new nested transaction");
    nestedTransaction.releaseTransaction = (releaseCustomCommand) => {
      // Nested transactions only set the custom command, only outermost transaction commits.
      this.setCustomCommand(releaseCustomCommand, "releasing nested transaction");
    };
    return nestedTransaction;
  }

  setCustomCommand (customCommandCandidate: any, context: string) {
    if (typeof customCommandCandidate === "undefined") return;
    invariantify(typeof this.customCommand === "undefined",
        `While ${context} '${this.transaction.corpus.getName()
            }' trying to override an existing customCommand`,
        "\n\tin transactionInfo:", this,
        "\n\toverriding custom command candidate:", customCommandCandidate);
    this.customCommand = customCommandCandidate;
  }

  claim (restrictedCommand: Command): ClaimResult {
    try {
      if (!this.restrictedActions) {
        throw new Error(`Transaction '${this.transaction.corpus.getName()}' has already been ${
                this.finalRestrictedTransactedLike ? "committed" : "aborted"
            }, when trying to add an action to it`);
      }
      // What goes on here is an incremental construction and universalisation of a TRANSACTED
      // command whenever a new restrictedCommand comes in, via dispatching the on-going
      // info.transacted only containing that particular command. Once the transaction is finally
      // committed, the pieces are put together in a complete, universal TRANSACTED.
      const index = this.restrictedActions.length;
      this.restrictedActions.push(restrictedCommand);

      const previousState = this.transaction.state;
      // This is an awkward way to incrementally construct the transacted.
      // Maybe generators could somehow be useful here?
      this.latestUniversalTransacted = {
        ...this.transacted,
        actions: [createUniversalizableCommand(restrictedCommand)],
      };
      const story = this.transaction.corpus.dispatch(
          this.latestUniversalTransacted, this.transactionClaimDescription);
      this.storyPassages.push(story.passages[0]);
      Object.assign(this.universalPartitions, story.partitions);

      const state = this.transaction.corpus.getState();
      this.transaction.setState(state);

      this.resultPromises.push(null);
      const result = new Promise((succeed, fail) =>
          (this.resultPromises[index] = { succeed, fail }));
      return {
        prophecy: new Prophecy(story.passages[0], state, previousState, restrictedCommand),
        getFinalEvent: () => result,
      };
    } catch (error) {
      throw this.transaction.wrapErrorEvent(error,
          `transaction.claim(${this.transaction.corpus.getName()})`,
          "\n\trestrictedCommand:", ...dumpObject(restrictedCommand),
      );
    }
  }

  commit (commitCustomCommand: ?Object): ClaimResult {
    let command;
    try {
      if (!this.restrictedActions) {
        throw new Error(`Transaction '${this.transaction.corpus.getName()}' has already been ${
                this.finalRestrictedTransactedLike ? "committed" : "aborted"
            }, when trying to commit it again`);
      }
      this.setCustomCommand(commitCustomCommand, "committing transaction");
      this.stateAfter = this.transaction.getState();

      this.transacted.actions = this.restrictedActions;
      this.restrictedActions = null;

      this.finalRestrictedTransactedLike = !this.customCommand
          ? this.transacted
          : this.customCommand(this.transacted);
      if (!this.customCommand && !this.finalRestrictedTransactedLike.actions.length) {
        const universalNoOpCommand = createUniversalizableCommand(
            this.finalRestrictedTransactedLike);
        universalNoOpCommand.partitions = {};
        return {
          prophecy: new Prophecy(universalNoOpCommand, undefined, undefined,
              this.finalRestrictedTransactedLike),
          getFinalEvent () { return universalNoOpCommand; },
        };
      }
      const result = this.transaction.prophet.claim(
          this.finalRestrictedTransactedLike, { transactionInfo: this });

      Promise.resolve(result.getFinalEvent()).then(
        // TODO(iridian): Implement returning results. What should they be anyway?
        innerResult => this.resultPromises.forEach((promise, index) =>
            promise.succeed(innerResult.actions && innerResult.actions[index])),
        failure => this.resultPromises.forEach((promise) =>
            promise.fail(failure)),
      );
      this.commitResult = result;
      return result;
    } catch (error) {
      throw this.transaction.wrapErrorEvent(error,
        `transaction(${this.transaction.corpus.getName()}).commit()`,
          "\n\tcommand:", ...dumpObject(command),
      );
    }
  }

  abort () {
    if (!this.restrictedActions && this.finalRestrictedTransactedLike) {
      throw new Error(`Transaction '${this.transaction.corpus.getName()
          }' has already been committed, when trying to abort it`);
    }
    this.restrictedActions = null;
  }

  releaseTransaction (releaseCustomCommand: ?Object) {
    this.setCustomCommand(releaseCustomCommand, "releasing transaction");
    // If the transaction has not yet been explicitly committed or discarded, commit it now.
    if (this.isCommittable()) this.commit();
    return this.commitResult;
  }


  /**
   * Tries to fast-forward this transaction on top of the given targetCorpus.
   * Returns a story of the transaction if successfull, undefined if fast forward was not possible.
   *
   * @param {Corpus} corpus
   * @returns
   *
   * @memberof TransactionInfo
   */
  tryFastForwardOnCorpus (targetCorpus: Corpus) {
    // this.logEvent(`Committing fast-forward transaction '${transactionInfo.name}'`);
    const previousState = targetCorpus.getState();
    if (!this.isFastForwardFrom(previousState)) return undefined;
    targetCorpus.reinitialize(this.stateAfter);
    // this.logEvent(`Committed '${transactionInfo.name}'`, story);

    const universalTransactedLike = {
      ...this.latestUniversalTransacted,
      ...this.finalRestrictedTransactedLike,
      actions: this.storyPassages.map(passage => getActionFromPassage(passage)),
      partitions: this.universalPartitions,
    };
    const story = createPassageFromAction(universalTransactedLike);
    story.passages = this.storyPassages;
    return story;
  }
}