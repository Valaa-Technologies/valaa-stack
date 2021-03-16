// @flow

import { OrderedMap } from "immutable";
import { created, EventBase } from "~/raem/events";

import { naiveURI } from "~/raem/ValaaURI";

import { createCorpus } from "~/raem/test/RAEMTestHarness";

import ScriptTestHarness, { createScriptTestHarness } from "~/script/test/ScriptTestHarness";

import {
  AuthorityNexus, FalseProphet, FalseProphetDiscourse, Oracle, Connection, Sourcerer,
  Scribe, Follower,
} from "~/sourcerer";
import { obtainAspect } from "~/sourcerer/tools/EventAspects";
import SOURCERER_EVENT_VERSION from "~/sourcerer/EVENT_VERSION";

import SourcererTestAPI from "~/sourcerer/test/SourcererTestAPI";
import createValaaTestScheme, { TestSourcerer, TestConnection }
    from "~/sourcerer/test/scheme-valaa-test";
import createValaaLocalScheme from "~/sourcerer/schemeModules/valaa-local";
import createValaaMemoryScheme from "~/sourcerer/schemeModules/valaa-memory";
import createValaaTransientScheme from "~/sourcerer/schemeModules/valaa-transient";
import { getDatabaseAPI } from "~/sourcerer/tools/getInMemoryDatabaseAPI";

import * as ValoscriptDecoders from "~/script/mediaDecoders";
import * as ToolsDecoders from "~/tools/mediaDecoders";

import { thenChainEagerly, mapEagerly } from "~/tools/thenChainEagerly";
import { dumpify, dumpObject, isPromise, trivialClone, wrapError } from "~/tools";

export const testAuthorityURI = "valaa-test:";
export const testRootId = "@$~raw.test_chronicle@@";
export const testChronicleURI = naiveURI.createChronicleURI(testAuthorityURI, testRootId);

export function createSourcererTestHarness (options: Object, ...commandBlocks: any) {
  const wrap = new Error("During createSourcererHarness");
  return thenChainEagerly({
    name: "SourcererFrontHarness", ContentAPI: SourcererTestAPI, TestHarness: SourcererTestHarness,
    ...options,
  }, [
    sourcererOptions => createScriptTestHarness(sourcererOptions),
    harness => {
      commandBlocks.forEach(commands => {
        harness.proclaimTestEvents(commands).eventResults.forEach((result, index) => {
          if (isPromise((result.getTruthEvent || result.getTruthStory).call(result))) {
            throw new Error(`command #${index} getTruthEvent resolves into a Promise.${
                ""} Use the asynchronous createSourcererOracleHarness instead.`);
          }
        });
      });
      return harness;
    }
  ], function errorOnCreateSourcererHarness (error) {
    throw wrapError(error, wrap,
        "\n\toptions:", ...dumpObject(options),
        "\n\tcommandBlocks:", ...dumpObject(commandBlocks));
  });
}

let dbIsolationAutoPrefix = 0;

export function createSourcererOracleHarness (options: Object, ...commandBlocks: any) {
  const isPaired = !!options.pairedHarness;
  const combinedOptions = {
    name: `${isPaired ? "Paired " : ""}FullSourcererHarness`,
    ...options,
    oracle: {
      verbosity: options.verbosity || 0,
      testAuthorityConfig: {
        ...(!isPaired ? {} : options.pairedHarness.testAuthorityConfig),
        ...((options.oracle || {}).testAuthorityConfig || {}),
      },
      ...(options.oracle || {}),
    },
    scribe: {
      verbosity: options.verbosity || 0,
      databasePrefix: `${isPaired ? "paired" : "test"}-isolated-${++dbIsolationAutoPrefix}-`,
      ...(options.scribe || {}),
    },
  };
  let harness;
  return thenChainEagerly(combinedOptions, [
    createSourcererTestHarness,
    function _acquireConnections (harness_) {
      harness = harness_;
      if (!options.acquireConnections) return [];
      const chronicleURIs = options.acquireConnections.map(
          chronicleId => naiveURI.createChronicleURI("valaa-test:", chronicleId));
      return mapEagerly(chronicleURIs, chronicleURI =>
          harness.sourcerer.sourcerChronicle(chronicleURI).asSourceredConnection());
    },
    connections => {
      connections.forEach(connection => {
        if (harness.sourcerer.getVerbosity() >= 1) {
          console.log("Connection fully active:", connection.debugId());
        }
      });
      return mapEagerly(commandBlocks,
          commands => mapEagerly(harness.proclaimTestEvents(commands).eventResults,
              combinedOptions.awaitResult || (result => result.getRecordedStory())));
    },
    () => harness,
  ], error => {
    throw !harness ? error : harness.wrapErrorEvent(
        error, 1, new Error("During createSourcererOracleHarness"),
        "\n\toptions:", ...dumpObject(options),
        "\n\tcommandBlocks:", ...dumpObject(commandBlocks));
  });
}

export const createTestChronicleEntityCreated = () => created({
  id: [testRootId], typeName: "Entity",
  initialState: {
    name: "Automatic Test Chronicle Root",
    authorityURI: "valaa-test:",
  },
});

export default class SourcererTestHarness extends ScriptTestHarness {
  constructor (options: Object) {
    super(options);
    this.nextCommandIdIndex = 1;
    this.oracleOptions = options.oracle;
    if (this.oracleOptions) this.testAuthorityConfig = this.oracleOptions.testAuthorityConfig;
    this.scribeOptions = options.scribe;
    this.cleanupScribe = () => (this.scribeOptions && clearAllScribeDatabases(this.scribe));
    this.falseProphetOptions = options.falseProphet;
    this.nexusOptions = options.nexus;
    this.testAuthorityURI = options.testAuthorityURI || testAuthorityURI;
    this.testChronicleURI = options.testChronicleURI
        || (options.testAuthorityURI
            && naiveURI.createChronicleURI(this.testAuthorityURI, testRootId))
        || testChronicleURI;
  }

  initialize () {
    let hasRemoteTestBackend;
    return thenChainEagerly(
      super.initialize(), [
        ...(!this.oracleOptions ? [
          () => createTestMockSourcerer({ isLocallyRecorded: false },
              { name: `${this.getName()} Sourcerer` }),
        ] : [
          () => createOracle(
              { name: `${this.getName()} Oracle`, ...(this.oracleOptions || {}), parent: this },
              { ...(this.nexusOptions || {}), parent: this }),
          oracle => (this.oracle = oracle),
        ]),
        ...(!this.scribeOptions ? [] : [
          upstream => createScribe(upstream,
              { name: `${this.getName()} Scribe`, ...(this.scribeOptions || {}), parent: this }),
          scribe => (this.scribe = scribe),
        ]),
        upstream => this.sourcerer.setUpstream(upstream),
        () => {
          hasRemoteTestBackend = (this.testAuthorityConfig || {}).isRemoteAuthority;
          const testChronicle = this.sourcerer.sourcerChronicle(
              this.testChronicleURI, { newChronicle: !hasRemoteTestBackend });
          if (hasRemoteTestBackend) {
            // For remote test chronicles with oracle we provide the root
            // entity as a response to the initial narrate request.
            const testBackend = this.tryGetTestAuthorityConnection(testChronicle);
            testBackend.addNarrateResults({ eventIdBegin: 0 }, [{
              ...createTestChronicleEntityCreated(),
              aspects: { version: "0.2", log: { index: 0 }, command: { id: "rid-0" } },
            }]);
          }
          return testChronicle.asSourceredConnection();
        },
        (testChronicle) => (this.testChronicle = testChronicle),
          // For non-remotes we chronicle the root entity explicitly.
        () => {
          if (hasRemoteTestBackend) return undefined;
          const result = this.proclaimTestEvent(
              createTestChronicleEntityCreated(), { isTruth: true });
          return result.getPremiereStory();
        },
      ],
      SourcererTestHarness.errorOn(new Error("SourcererTestHarness.initialize")),
    );
  }

  proclaimTestEvents (events: EventBase[], ...rest: any) {
    return this.chronicler.proclaimEvents(events.map(e => trivialClone(e)), ...rest);
  }

  createCorpus (corpusOptions: Object = {}) {
    // Called by RAEMTestHarness.constructor (so before oracle/scribe are created)
    const corpus = super.createCorpus(corpusOptions);
    this.sourcerer = this.falseProphet = createFalseProphet({
      name: `${this.getName()} FalseProphet`,
      schema: this.schema, corpus,
      ...(this.falseProphetOptions || {}),
      parent: this,
    });
    this.chronicler = this.sourcerer;
    return corpus;
  }

  createValker () {
    return (this.discourse = this.chronicler = new FalseProphetDiscourse({
      name: `${this.getName()} Discourse`,
      sourcerer: this.sourcerer,
      parent: new MockFollower(this),
      verbosity: this.getVerbosity(),
      schema: this.schema,
      packFromHost: value => (value instanceof OrderedMap ? value.get("id") : value),
      unpackToHost: value => {
        if (!(value instanceof OrderedMap)) return value;
        const id = value.get("id");
        if (!id || (id.typeof() !== "Resource")) return value;
        return id;
      },
      steppers: this.corpusOptions.steppers,
      assignCommandId: (command) => {
        obtainAspect(command, "command").id = `test-cid-${this.nextCommandIdIndex++}`;
      },
    }));
  }

  /**
   * Retrieves out-going test chronicle commands from the given source,
   * converts them into truths and then has corresponding active
   * connections in this harness receive them via their receiveTruths.
   *
   * @param {(Sourcerer | Connection)} source
   * @param {*} [{
   *     requireReceivingConnection = true,
   *     clearSourceUpstream = false,
   *     clearReceiverUpstream = false,
   *     authorizeTruth = (i => i),
   *   }={}]
   * @memberof SourcererTestHarness
   */
  receiveEventsFrom (source: Sourcerer | Connection, {
    verbosity = 0,
    requireReceivingConnection = true,
    clearSourceUpstream = false,
    alsoReceiveBackToSource = false,
    clearReceiverUpstream = false,
    authorizeTruth = (i => i),
    asNarrateResults = false,
  } = {}) {
    const ret = [];
    const finallyWaitFor = [];
    for (const connection of ((source instanceof Connection)
        ? [source]
        : Object.values((source instanceof Sourcerer ? source : source.sourcerer)._connections))) {
      const testSourceBackend = this.tryGetTestAuthorityConnection(connection);
      if (!testSourceBackend) {
        throw new Error(`Can't find source connection: ${connection.getName()}`);
      }
      const chronicleURI = testSourceBackend.getChronicleURI();
      const receiver = this.oracle._connections[chronicleURI];
      if (!receiver) {
        if (!requireReceivingConnection) continue;
        throw new Error(`Could not find a receiving connection for <${chronicleURI}>`);
      }
      const receiverBackend = this.tryGetTestAuthorityConnection(receiver);
      if (!receiverBackend) {
        throw new Error(`Receving connection <${chronicleURI
            }> has no TestConnection at the end of the chain`);
      }
      const truths = JSON.parse(JSON.stringify(
              (testSourceBackend._proclamations || []).map(entry => entry.event)))
          .map(authorizeTruth);
      ret.push(...truths);
      if (alsoReceiveBackToSource) {
        const sourceAsNarrateResults = alsoReceiveBackToSource === "asNarrateResults";
        if (!sourceAsNarrateResults && (alsoReceiveBackToSource !== "asPush")) {
          throw new Error("alsoReceiveBackToSource must be either 'asPush' or 'asNarrateResults");
        }
        finallyWaitFor.push(
          this._receiveTruthsToBackend(testSourceBackend,
              true, truths, sourceAsNarrateResults, verbosity && "back to source"));
      } else if (clearSourceUpstream) {
        finallyWaitFor.push(
          this._receiveTruthsToBackend(testSourceBackend, true));
      }
      finallyWaitFor.push(
          this._receiveTruthsToBackend(receiverBackend, clearReceiverUpstream,
              truths, asNarrateResults, verbosity && "to receiver"));
    }
    return Promise.all(finallyWaitFor).then(() => ret);
  }

  _receiveTruthsToBackend (connectionBackend, clearUpstream, truths, asNarrateResults, verbosity) {
    if (clearUpstream) connectionBackend._proclamations = [];
    if (verbosity) {
      connectionBackend.warnEvent("Receiving truths", verbosity,
          asNarrateResults ? "as narrate results" : "by pushing to receive truths",
          dumpify(truths, { indent: 2 }));
    }
    if (!truths) return [];
    if (!asNarrateResults) {
      return connectionBackend.getReceiveTruths()(truths);
    }
    connectionBackend.addNarrateResults({ eventIdBegin: truths[0].aspects.log.index }, truths);
    return undefined;
  }

  tryGetTestAuthorityConnection (connection): Connection {
    let ret = connection;
    for (; ret; ret = ret.getUpstreamConnection()) {
      if (ret instanceof TestConnection) break;
    }
    return ret;
  }

  createMockFollower () {
    const ret = MockFollower();
    ret.discourse = ret.sourcerer.addFollower(ret);
    return ret;
  }
}

const activeScribes = [];

export function createScribe (upstream: Sourcerer, options?: Object) {
  const ret = new Scribe({
    name: "Test Scribe",
    databaseAPI: getDatabaseAPI(),
    upstream,
    ...options,
  });
  activeScribes.push(ret);
  return ret.initiate();
}

export async function clearAllScribeDatabases () {
  for (const scribe of activeScribes.slice()) {
    await clearScribeDatabases(scribe);
  }
}

async function clearScribeDatabases (scribe: Scribe) {
  const index = activeScribes.findIndex(candidate => (candidate === scribe));
  if (index === -1) return;
  activeScribes.splice(index, 1);
  await scribe.terminate({ deleteDatabases: true });
}

export function createOracle (options?: Object, nexusOptions?: Object) {
  const authorityNexus = new AuthorityNexus(nexusOptions);
  const ret = new Oracle({
    name: "Test Oracle",
    ...options,
    authorityNexus,
  });
  authorityNexus.addSchemeModule(createValaaLocalScheme({ parent: ret }));
  authorityNexus.addSchemeModule(createValaaTransientScheme({ parent: ret }));
  authorityNexus.addSchemeModule(createValaaMemoryScheme({ parent: ret }));
  authorityNexus.addSchemeModule(createValaaTestScheme({
    parent: ret, config: (options || {}).testAuthorityConfig,
  }));
  for (const Decoder: any of Object.values({ ...ToolsDecoders, ...ValoscriptDecoders })) {
    if (Decoder.mediaTypes) {
      ret.getDecoderArray().addDecoder(new Decoder({ parent: ret }));
    }
  }
  return ret;
}

export function createFalseProphet (options?: Object) {
  const corpus = (options && options.corpus) || createCorpus(SourcererTestAPI, {}, {});
  return new FalseProphet({
    name: "Test FalseProphet",
    corpus,
    ...options,
  });
}

export function createTestMockSourcerer (configOverrides: Object = {}, sourcererOverrides = {}) {
  return new TestSourcerer({
    authorityURI: "valaa-test:",
    authorityConfig: {
      eventVersion: SOURCERER_EVENT_VERSION,
      isLocallyRecorded: true,
      isPrimaryAuthority: true,
      isRemoteAuthority: false,
      ...configOverrides,
    },
    ...sourcererOverrides,
  });
}

export class MockFollower extends Follower {
  receiveTruths (truths: Object[]): Promise<(Promise<EventBase> | EventBase)[]> {
    return truths;
  }
  receiveCommands (commands: Object[]): Promise<(Promise<EventBase> | EventBase)[]> {
    return commands;
  }
}
