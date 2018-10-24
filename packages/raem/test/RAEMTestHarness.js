import { OrderedMap } from "immutable";

import type Command from "~/raem/command/Command";
import createRootReducer from "~/raem/tools/createRootReducer";
import createValidateActionMiddleware from "~/raem/redux/middleware/validateAction";
import createProcessCommandIdMiddleware from "~/raem/redux/middleware/processCommandId";
import createProcessCommandVersionMiddleware from
    "~/raem/redux/middleware/processCommandVersion";
import { createBardMiddleware, isProclamation, createUniversalizableCommand }
    from "~/raem/redux/Bard";

import RAEMTestAPI from "~/raem/test/RAEMTestAPI";

import Corpus from "~/raem/Corpus";
import Valker from "~/raem/VALK/Valker";

import { dumpObject, invariantify, LogEventGenerator, valaaUUID, wrapError } from "~/tools";

const DEFAULT_EVENT_VERSION = "0.2";

export function createRAEMTestHarness (options: Object, ...proclamationBlocks: any) {
  try {
    const TestHarness = options.TestHarness || RAEMTestHarness;
    const ret = new TestHarness({
      name: "RAEM Test Harness", ContentAPI: RAEMTestAPI,
      ...options,
    });
    proclamationBlocks.forEach(proclamations => proclamations.forEach(proclamation =>
        ret.dispatch(proclamation)));
    return ret;
  } catch (error) {
    throw wrapError(error, new Error("During createProphetTestHarness"),
        "\n\toptions:", ...dumpObject(options),
        "\n\tproclamationBlocks:", ...dumpObject(proclamationBlocks));
  }
}

export default class RAEMTestHarness extends LogEventGenerator {
  constructor ({ ContentAPI, name, debug, reducerOptions = {}, corpusOptions = {} }) {
    super({ name, debugLevel: debug });
    this.ContentAPI = ContentAPI;
    this.schema = ContentAPI.schema;
    this.reducerOptions = reducerOptions;
    this.corpusOptions = corpusOptions;
    this.corpus = this.createCorpus();
    this.valker = this.createValker();
  }

  getState () { return this.corpus.getState(); }

  /**
   * run always delegates the run to most sophisticated component in the harness.
   * For RAEMTestHarness, the target is the corpus.
   *
   * @param {any} rest
   *
   * @memberof RAEMTestHarness
   */
  run (...rest) {
    this.valker.setState(this.corpus.getState());
    const ret = this.valker.run(...rest);
    this.corpus.setState(this.valker.getState());
    return ret;
  }

  /**
   * dispatch always delegates the operation to corpus.dispatch (handlings restricted commands is
   * done via .proclaim, which is not available in @valos/raem). Also does validation for
   * is-restricted for incoming commands, and for is-universal for resulting stories.
   *
   * @param {any} rest
   *
   * @memberof RAEMTestHarness
   */
  dispatch (proclamation: Command) {
    let story;
    try {
      const universalizableCommand = createUniversalizableCommand(proclamation);
      invariantify(isProclamation(universalizableCommand),
          "universalizable command must still be restricted");
      story = this.corpus.dispatch(universalizableCommand);
      invariantify(!isProclamation(universalizableCommand),
          "universalized story must not be restricted");
      return story;
    } catch (error) {
      throw this.wrapErrorEvent(error, "Dispatch",
          "\n\trestrictedCommand:", ...dumpObject(proclamation),
          "\n\tstory:", ...dumpObject(story));
    }
  }

  createCorpus () {
    return createCorpus(this.ContentAPI, {
      eventLogger: this,
      ...this.reducerOptions,
    }, {
      name: `${this.getName()} Corpus`,
      debugLevel: this.getDebugLevel(),
      logger: this.getLogger(),
      // stubify all unpacked Transient's when packing: this causes them to autorefresh
      ...this.corpusOptions,
    });
  }

  createValker () {
    return new Valker(
        this.schema,
        this.getDebugLevel(),
        this,
        value => (value instanceof OrderedMap ? value.get("id") : value),
        value => {
          if (!(value instanceof OrderedMap)) return value;
          const id = value.get("id");
          if (!id || (id.typeof() !== "Resource")) return value;
          return id;
        },
        this.corpusOptions.builtinSteppers,
    );
  }
}

export function createCorpus (ContentAPI: Object, reducerOptions?: Object, corpusOptions?: Object) {
  const { schema, validators, mainReduce, subReduce } = createRootReducer(Object.freeze({
    ...ContentAPI,
    ...reducerOptions,
  }));
  return new Corpus(Object.freeze({
    name: "Test Corpus",
    middlewares: _createTestMiddlewares({ schema, validators }),
    initialState: OrderedMap(),
    reduce: mainReduce,
    subReduce,
    schema,
    ...corpusOptions,
  }));
}

function _createTestMiddlewares ({ schema, validators }) {
  const previousId = valaaUUID();
  return [
    createProcessCommandVersionMiddleware(DEFAULT_EVENT_VERSION),
    createProcessCommandIdMiddleware(previousId, schema),
    createValidateActionMiddleware(validators),
    createBardMiddleware(),
  ];
}
