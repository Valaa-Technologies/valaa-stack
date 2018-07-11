#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const util = require("util");

const cardinal = require("cardinal");
const colors = require("colors/safe");
const inquirer = require("inquirer");
const minimatch = require("minimatch");
const semver = require("semver");
const shell = require("shelljs");
const yargs = require("yargs/yargs");
const yargsParser = require("yargs-parser").detailed;

cardinal.tomorrowNight = require("cardinal/themes/tomorrow-night");

/* eslint-disable vars-on-top, no-loop-func, no-restricted-syntax, no-cond-assign,
                  import/no-dynamic-require
*/

const globalVargs = _createVargs(process.argv.slice(2));

/*
   #    ######    ###
  # #   #     #    #
 #   #  #     #    #
#     # ######     #
####### #          #
#     # #          #
#     # #         ###
*/

const nodeCheck = ">=8.10.0";
const npmCheck = ">=5.0.0";

const defaultPaths = {
  poolBase: path.posix.resolve("."),
  poolDirectories: ["valma.bin/", "node_modules/.bin/"],
  globalPool: process.env.VLM_GLOBAL_POOL || (shell.which("vlm") || "").slice(0, -3),
};

const defaultCommandPrefix = "valma-";

// vlm - the Valma global API singleton - these are available to all command scripts via their
// yargs.vlm (in scripts exports.builder) as well as yargv.vlm (in scripts exports.handler).
const vlm = globalVargs.vlm = {
  // Calls valma command with argv.
  // Any plain objects are expanded to boolean or parameterized flags depending on the value type.
  invoke,

  // Executes an external command and returns a promise of the command stdandard output as string.
  // Any plain objects are expanded to boolean or parameterized flags depending on the value type.
  execute,

  cwd: process.cwd(),

  // Immutable contents of package.json (contains pending updates as well)
  packageConfig: undefined,

  // Immutable contents of toolsets.json (contains pending updates as well)
  toolsetsConfig: undefined,

  getPackageConfig,
  getValmaConfig,
  getToolsetsConfig,

  // Registers pending updates to the package.json config file (immediately updates
  // vlm.packageConfig) which are written to file only immediately before valma execution exits or
  // an external command is about to be executed.
  // TODO(iridian): Improve the flush semantics, maybe to flush-on-subcommand-success - now it's
  // just silly.
  updatePackageConfig,

  // Registers pending updates to the toolsets.json config file (immediately updates
  // vlm.toolsetsConfig) which are written to file only immediately before valma execution exits or
  // an external command is about to be executed.
  // TODO(iridian): Improve the flush semantics, maybe to flush-on-subcommand-success - now it's
  // just silly.
  updateToolsetsConfig,

  // TODO(iridian): These should eventually be in a separate library. Fundamentally valma shouldn't
  // know about toolsets. OTOH valma type and the toolset scripts are part of valma package, so...
  getToolsetConfig,
  getToolConfig,
  confirmToolsetExists,
  updateToolsetConfig,
  updateToolConfig,
  createStandardToolsetOption,

  // Returns a list of available sub-command names which match the given command glob.
  listMatchingCommands,
  listAllMatchingCommands,

  // Enables usage of ANSI colors using the safe variant of Marak's colors
  // See https://github.com/Marak/colors.js
  colors,

  // The currently active theme.
  theme: colors,

  // Opens interactive inquirer prompt and returns a completion promise.
  // See https://github.com/SBoudrias/Inquirer.js/
  inquire: inquirer.createPromptModule(),

  // shelljs namespace of portable Unix commands
  // See https://github.com/shelljs/shelljs
  shell,

  // semver namespace of the npm semver parsing tools
  // See https://github.com/npm/node-semver
  semver,

  // minimatch namespace of the glob matching tools
  // See https://github.com/isaacs/minimatch
  minimatch,

  // node.js path.posix tools - all shell commands expect posix-style paths.
  // See https://nodejs.org/api/path.html
  path: path.posix,

  // forward to node require. Non-absolute paths are resolved from the cwd.
  require: function require_ (path_) {
    const resolvedPath = require.resolve(path_, { paths: [this.cwd] });
    if (!resolvedPath) {
      throw new Error(`Could not require.resolve path "${path_}" from cwd "${this.cwd}"`);
    }
    return require(resolvedPath);
  },

  // minimatch namespace of the glob matching tools
  // See https://github.com/isaacs/minimatch
  cardinal,
  cardinalDefault: { theme: cardinal.tomorrowNight, linenos: true },

  // Syntactic sugar

  tailor (...customizations) {
    return Object.assign(Object.create(this), ...customizations);
  },

  readFile: util.promisify(fs.readFile),
  async tryReadFile (...rest) {
    try { return await this.readFile(...rest); } catch (error) {
      return undefined;
    }
  },

  inquireText: async (message, default_ = "") =>
      (await vlm.inquire({
        type: "input", name: "text", message, default: default_,
      })).text,
  inquireConfirm: async (message, default_ = true) =>
      (await vlm.inquire({
        type: "confirm", name: "confirm", message, default: default_,
      })).confirm,

  contextCommand: "vlm",
  contextIndex: undefined,
  getContextName: function getContextName () {
    return `${this.getContextIndexText()}${this.contextCommand}`;
  },
  getContextIndexText: function getContextIndexText () {
    return (this.contextIndex === undefined) ? "" : `[${this.contextIndex}] `;
  },

  render (type, ...rest) {
    const renderer = _renderers[type || ""];
    return renderer && rest.map(renderer);
  },

  ifVerbose (minimumVerbosity, callback) {
    function ssh () { return this; }
    if (this.verbosity < minimumVerbosity) {
      return {
        ifVerbose: ssh, log: ssh, echo: ssh, warn: ssh, error: ssh, exception: ssh, info: ssh,
        babble: ssh, expound: ssh,
      };
    }
    if (callback) callback.call(this);
    return this;
  },

  // Alias for console.log for unprocessed payload output directly to stdout
  log (...rest) {
    console.log(...rest);
    return this;
  },
  result (...rest) {
    const output = this.render(globalVargv.results, ...rest);
    if (output) console.log(...output);
    return this;
  },
  // Alias for console.warn for unprocessed diagnostics output directly to stderr
  speak (...rest) {
    console.warn(...rest);
    return this;
  },
  // Echo the valma wildcard matchings, invokations and external executions back to the user.
  // As a diagnostic message outputs to stderr where available.
  echo (...rest) {
    if (this.theme.echo) {
      if ((rest[0] || "").includes("<<")) this.indent -= 2;
      console.warn(" ".repeat(this.indent - 1), this.theme.echo(...rest));
      if ((rest[0] || "").includes(">>")) this.indent += 2;
    }
    return this;
  },
  indent: 4,

  // Diagnostics ops
  // These operations prefix the output with the command name and a verb describing the type of
  // the communication. They output to stderr where available.

  // When something unexpected happens which doesn't necessarily prevent the command from finishing
  // but might nevertheless be the root cause of errors later.
  // An example is a missing node_modules due to a lacking 'yarn install': this doesn't prevent
  // 'vlm --help' but would very likely be the cause for a 'cannot find command' error.
  // As a diagnostic message outputs to stderr where available.
  warn (msg, ...rest) {
    if (this.theme.warning) {
      console.warn(this.theme.warning(`${this.contextCommand} warns:`, msg), ...rest);
    }
    return this;
  },
  // When something is definitely wrong and operation cannot do everything that was expected
  // but might still complete.
  // As a diagnostic message outputs to stderr where available.
  error (msg, ...rest) {
    if (this.theme.error) {
      console.error(this.theme.error(`${this.getContextName()} laments:`, msg), ...rest);
    }
    return this;
  },
  // When something is catastrophically wrong and operation terminates immediately.
  // As a diagnostic message outputs to stderr where available.
  exception (error, ...rest) {
    if (this.theme.exception) {
      if (!error) {
        const dummy = {};
        Error.captureStackTrace(dummy);
        console.error(this.theme.exception(`vlm.exception: no error provided! ${dummy.stack}`));
      } else {
        console.error(this.theme.exception(`${this.getContextName()} panics: ${error}`), ...rest);
      }
    }
    return this;
  },
  // Info messages are mildly informative, non-noisy, unexceptional yet quite important. They
  // provide a steady stream of relevant information about reality an attuned devop expects to see.
  // In so doing they enable the devop to notice a divergence between reality and their own
  // expectations as soon as possible and take corrective action. In particular, they are used to:
  // 1. confirm choices that were made or tell about choices that will need to be made
  // 2. inform about execution pathways taken (like --dry-run or prod-vs-dev environment)
  // 3. communicate about the progress of the operation phases,
  // etc.
  // As a diagnostic message outputs to stderr where available.
  // Note! This is a divergence from Node console.info which outputs to stdout. However, diagnostics
  // messages need to go to stderr so that they can be separated from payload output and work
  // correctly with piping in general.
  info (msg, ...rest) {
    if (this.theme.info) {
      console.warn(this.theme.info(`${this.getContextName()} informs:`, msg), ...rest);
    }
    return this;
  },
  instruct (msg, ...rest) {
    if (this.theme.instruct) {
      console.warn(this.theme.instruct(`${this.getContextName()} instructs:`, msg), ...rest);
    }
    return this;
  },
  // Babble and expound are for learning and debugging. They are messages an attuned devop doesn't
  // want to see as they are noisy and don't fit any of the info criterias above.
  // They should always be gated behind --verbose.
  // Babble is for messages which take only couple lines.
  // As a diagnostic message outputs to stderr where available.
  babble (msg, ...rest) {
    if (this.theme.babble) {
      console.warn(this.theme.babble(`${this.getContextName()} babbles:`, msg), ...rest);
    }
    return this;
  },

  // Expound messages can be arbitrarily immense.
  // As a diagnostic message outputs to stderr where available.
  expound (msg, ...rest) {
    if (this.theme.expound) {
      console.warn(this.theme.expound(`${this.getContextName()} expounds:`, msg), ...rest);
    }
    return this;
  },
};

colors._setTheme = function _setTheme (obj) {
  this.decorate = (rule) => {
    if ((rule === undefined) || (rule === null)) return (...rest) => rest;
    if (typeof rule === "string") return this.decorate(this[rule]);
    if (typeof rule === "function") return (...rest) => rule.apply(this, rest);
    if (Array.isArray(rule)) {
      return rule.map(this.decorate).reduceRight(
          (next, cur) => (...rest) => next(...[].concat(cur(...rest))));
    }
    return (...rest) => Object.keys(rule).reduce(
        (subRest, ruleKey) => this.decorate(ruleKey)(...[].concat(subRest), rule[ruleKey]),
        rest);
  };
  Object.keys(obj).forEach(name => {
    const rule = obj[name];
    this[name] = (typeof rule === "function")
        ? rule
        : (...rest) => this.decorate([rule, "join"])(...rest);
  });
};

const themes = {
  default: {
    join: (...rest) => [].concat(...rest).join(" "),
    prefix: (...rest) => [].concat(rest[(rest.length || 1) - 1] || [], ...rest.slice(1)),
    suffix: (...rest) => rest,
    first (...rest) {
      return [].concat(...rest.slice(0, -1)
          .map((e, index) => ((index > 0) ? e : this.decorate(rest[rest.length - 1])(e))));
    },
    nonfirst (...rest) {
      const mappedRest = this.decorate(rest[rest.length - 1])(...rest.slice(1, -1));
      return ((rest.length <= 1) ? []
          : [rest[0]].concat(mappedRest || (typeof mappedRest === "number") ? mappedRest : []));
    },
    newlinesplit: (...rest) => [].concat(...[].concat(...rest).map(
        entry => [].concat(...String(entry).split("\n").map(line => [line, "\n"])))),
    flatsplit: (...rest) => [].concat(...[].concat(...rest).map(entry => String(entry).split(" "))),
    default: (...rest) => ((rest.length <= 1) ? rest
        : (e => (e.length <= 1 ? e : e.slice(0, -1)))(
            rest.filter(e => (e || (typeof e === "number"))))),
    cardinal (...rest) {
      if (!rest.length) return [];
      if (rest.length === 1) return cardinal.highlight(rest[0], vlm.cardinalDefault);
      return rest.slice(0, -1).map(s =>
          cardinal.highlight(s, rest[rest.length - 1] || vlm.cardinalDefault));
    },
    heading: (...rest) => ((typeof rest[rest.length - 1] !== "number") ? rest
        : ["#".repeat(Math.max(1, Math.min(6, rest[rest.length - 1]))), ...rest.slice(0, -1)]
            .join(" ")),

    echo: "dim",
    warning: ["bold", "yellow"],
    error: ["bold", "red"],
    exception: ["newlinesplit", { first: "error", nonfirst: "warning" }],
    info: "cyan",
    instruct: ["bold", "cyan"],
    babble: "cyan",
    expound: "cyan",
    argument: ["blue", "bold"],
    executable: ["flatsplit", { first: ["magenta"], nonfirst: "argument" }],
    command: ["flatsplit", { first: ["magenta", "bold"], nonfirst: "argument" }],
    overridden: ["strikethrough", "command"],
    package: ["dim", "bold", "yellow"],
    path: ["underline"],
    version: ["italic"],
  },
};

colors._setTheme(themes.default);
themes.default = colors;
themes.colorless = Object.keys(themes.default).reduce((theme, key) => {
  theme[key] = function colorless (...rest) { return rest.map(k => String(k)).join(" "); };
  return theme;
}, {});

const _renderers = {
  omit: null,
  json: (value) => JSON.stringify(value, null, 2),
  "json-compact": (value) => JSON.stringify(value),
  markdown: (value) => _toGFMarkdown(value, vlm.theme),
};


module.exports = {
  command: "vlm [--help] [-<flagchars>] [--<flag>...] [--<option>=<value>..] [command]",
  describe: "Dispatch a valma command to its command script",
  introduction: `Valma (or 'vlm') is a command script dispatcher.

Any npm package can export new valma commands by exporting .js command
scripts via its package.json .bin stanza. When such a package is added
as a devDependency for a repository valma will then be able to locate
and invoke those commands from anywhere inside the repository.

Valma commands are hierarchical and can contain '/' in their names.
Valma invokations can use glob matching to make full use of these
hierarchical path parts (notably using the distinction between '*' and
'**').

A command for which any path part begins with '.' is hidden, all other
commands are listed. Listed scripts can be seen with 'vlm',
'vlm --help' or 'vlm -d' and they are typically intended to be called
by the user via the command line. Hidden scripts don't appear in
listings and are intended to be called by other valma scripts. They can
nevertheless be called directly and can be listed with option -a.

The export name in the npm package.json .bin stanza must be the command
name prefixed with 'valma-' (or '.valma-' if a hidden command begins
with a '.'). Additionally export name must have all '/' replaced with
'_' due to npm limitations. Valma will always treat '_' and '/'
characters to be equal although '/' is recommended anywhere possible.
`,

  builder: (vargs_) => vargs_
  //    .usage(module.exports.command, module.exports.describe, iy => iy)
      .options({
        p: {
          group: "Valma root options:",
          alias: "pools", type: "boolean", global: false,
          description: "Show overridden pool commands and empty pool headers.",
        },
        s: {
          group: "Valma root options:",
          alias: "silence", type: "boolean", global: false,
          description: "Silence all console output except errors and potential results.",
          causes: [
            "no-echos", "no-logs", "no-infos", "no-instructs", "no-warnings", "no-babbles",
            "no-expounds"
          ],
        },
        v: {
          group: "Valma root options:",
          alias: "verbose", count: true, global: false,
          description: "Be noisy. -vv... -> be more noisy.",
        },
        echos: {
          group: "Valma root options:",
          type: "boolean", global: false, default: true,
          description: "Show echo messages",
        },
        logs: {
          group: "Valma root options:",
          type: "boolean", global: false, default: true,
          description: "Show log messages",
        },
        infos: {
          group: "Valma root options:",
          type: "boolean", global: false, default: true,
          description: "Show info messages",
        },
        instructs: {
          group: "Valma root options:",
          type: "boolean", global: false, default: true,
          description: "Show instruct messages",
        },
        warnings: {
          group: "Valma root options:",
          type: "boolean", global: false, default: true,
          description: "Show warning messages",
        },
        babbles: {
          group: "Valma root options:",
          type: "boolean", global: false, default: true,
          description: "Show babble messages",
        },
        expounds: {
          group: "Valma root options:",
          type: "boolean", global: false, default: true,
          description: "Show expound messages",
        },
        results: {
          group: "Valma root options:",
          type: "string", global: false, default: "markdown", choices: Object.keys(_renderers),
          description: "Show result value in output",
        },
        json: {
          group: "Valma root options:",
          type: "boolean", global: false,
          description: "Alias for --results=json for rendering result as JSON into standard output",
          causes: "results=json",
        },
        interactive: {
          group: "Valma root options:",
          type: "boolean", default: true, global: false,
          description: "Prompt for missing fields. If false then missing required fields will throw"
        },
        promote: {
          group: "Valma root options:",
          type: "boolean", default: true, global: false,
          description: "Promote to 'vlm' in the most specific pool available via forward",
        },
        "npm-config-env": {
          group: "Valma root options:",
          type: "boolean", default: true, global: false,
          description: "Add npm global environment if they are missing",
        },
        "package-config-env": {
          group: "Valma root options:",
          type: "boolean", default: false, global: false,
          description: "Add npm package environment variables if they are missing (not implemented)",
        },
        forward: {
          group: "Valma root options:",
          type: "boolean", default: true, global: false,
          description: "Allow vlm forwarding due to promote, node-env or need to load vlm path",
        },
        "command-prefix": {
          group: "Valma root options:",
          type: "string", default: defaultCommandPrefix, global: false,
          description: "The command prefix valma uses to recognize command script files.",
        },
        "pool-base": {
          group: "Valma root options:",
          type: "string", default: defaultPaths.poolBase, global: false,
          description: "Initial pool base path for gathering pools through all parent paths.",
        },
        "pool-directories": {
          group: "Valma root options:", array: true,
          type: "string", default: defaultPaths.poolDirectories, global: false,
          description: "Pool directories are appended to current pool base to locate pools",
        },
        "global-pool": {
          group: "Valma root options:",
          type: "string", default: defaultPaths.globalPool || null, global: false,
          description: "Global pool path is the last pool to be searched",
        },
        "bash-completion": {
          group: "Valma root options:",
          type: "boolean", global: false,
          description: "Output bash completion script",
        },
      }),
  handler, // Defined below.
};

function _addUniversalOptions (vargs_,
      { strict = true, global = false, hidden = false, theme = themes.colorless }) {
  function _postProcess (options) {
    Object.keys(options).forEach(name => {
      if (options[name].hidden) delete options[name].group;
    });
    return options;
  }
  const hiddenGroup = `Universal options${!hidden ? "" : ` ('${theme.command("vlm -h <cmd>")
      }' for full list)`}:`;
  return vargs_
      .strict(strict)
      .help(false)
      .version(false)
      .wrap(vargs_.terminalWidth() < 140 ? vargs_.terminalWidth() : 140)
      .option(_postProcess({
        a: {
          alias: theme.argument("match-all"),
          group: hiddenGroup, type: "boolean", global,
          description: "Include hidden and disabled commands in /all/ matchings",
        },
        d: {
          alias: theme.argument("dry-run"),
          group: hiddenGroup, type: "boolean", global,
          description: "Do not execute but display all the matching command(s)",
        },
        h: {
          alias: "help",
          group: hiddenGroup, type: "boolean", global,
          description: "Show the main help of the command",
        },
        N: {
          alias: theme.argument("show-name"),
          group: "Universal options:", type: "boolean", global, hidden,
          description: "Show the command (N)ame column",
        },
        U: {
          alias: theme.argument("show-usage"),
          group: "Universal options:", type: "boolean", global, hidden,
          description: "Show the command (U)sage column",
        },
        D: {
          alias: theme.argument("show-description"),
          group: "Universal options:", type: "boolean", global, hidden,
          description: "Show the command one-liner (D)escription column",
        },
        P: {
          alias: theme.argument("show-package"),
          group: "Universal options:", type: "boolean", global, hidden,
          description: "Show the command (P)ackage name column",
        },
        V: {
          alias: [theme.argument("show-version"), theme.argument("version")],
          group: "Universal options:", type: "boolean", global, hidden,
          description: "Show the command (V)ersion column",
        },
        O: {
          alias: theme.argument("show-pool"),
          group: "Universal options:", type: "boolean", global, hidden,
          description: "Show the command source p(O)ol column",
        },
        F: {
          alias: theme.argument("show-file"),
          group: "Universal options:", type: "boolean", global, hidden,
          description: "Show the command (F)ile path column",
        },
        R: {
          alias: theme.argument("show-resolved"),
          group: "Universal options:", type: "boolean", global, hidden,
          description: "Show the command symlink-(R)esolved path column",
        },
        I: {
          alias: theme.argument("show-introduction"),
          group: "Universal options:", type: "boolean", global, hidden,
          description: "Output the full (I)ntroduction of the command",
        },
        S: {
          alias: theme.argument("show-source"),
          group: "Universal options:", type: "boolean", global, hidden,
          description: "Output the script (S)ource code of the command",
        },
      }));
}

/*
  ###                               ##
   #     #    #     #     #####    #  #      #    #    ##       #    #    #
   #     ##   #     #       #       ##       ##  ##   #  #      #    ##   #
   #     # #  #     #       #      ###       # ## #  #    #     #    # #  #
   #     #  # #     #       #     #   # #    #    #  ######     #    #  # #
   #     #   ##     #       #     #    #     #    #  #    #     #    #   ##
  ###    #    #     #       #      #### #    #    #  #    #     #    #    #
*/

vlm.isCompleting = (process.argv[2] === "--get-yargs-completions");
const processArgv = vlm.isCompleting ? process.argv.slice(3) : process.argv.slice(2);

let nextContextIndex;

_addUniversalOptions(globalVargs, { strict: !vlm.isCompleting, hidden: false });
module.exports.builder(globalVargs);
const globalVargv = _parseUntilLastPositional(globalVargs, processArgv, module.exports.command);

const _commandPrefix = globalVargv.commandPrefix;

vlm.verbosity = vlm.isCompleting ? 0 : globalVargv.verbose;
vlm.interactive = vlm.isCompleting ? 0 : globalVargv.interactive;
if (!globalVargv.echos || vlm.isCompleting) vlm.echo = function noEcho () { return this; };
else {
  nextContextIndex = 0;
}
if (!globalVargv.logs || vlm.isCompleting) vlm.log = function noLog () { return this; };
if (!globalVargv.infos || vlm.isCompleting) vlm.info = function noInfo () { return this; };
if (!globalVargv.instructs || vlm.isCompleting) vlm.instruct = function noInstr () { return this; };
if (!globalVargv.warnings || vlm.isCompleting) vlm.warn = function noWarning () { return this; };
if (!globalVargv.babbles || vlm.isCompleting) vlm.babble = function noBabble () { return this; };
if (!globalVargv.expounds || vlm.isCompleting) vlm.expound = function noExpound () { return this; };

vlm.ifVerbose(1).babble("phase 1, init:", "determine global options and available pools.",
    `\n\tcommand: ${vlm.theme.command(globalVargv.command)
        }, verbosity: ${vlm.verbosity}, interactive: ${vlm.interactive}, echo: ${globalVargv.echo}`,
    "\n\tprocess.argv:", ...process.argv
).ifVerbose(2).babble("paths:", "cwd:", process.cwd(),
    "\n\tprocess.env.VLM_GLOBAL_POOL:", process.env.VLM_GLOBAL_POOL,
    "\n\tprocess.env.VLM_PATH:", process.env.VLM_PATH,
    "\n\tprocess.env.PATH:", process.env.PATH,
    "\n\tdefaultPaths:", JSON.stringify(defaultPaths)
).ifVerbose(3).expound("global options:", globalVargv);

const _availablePools = [];
// When a command begins with ./ or contains the command prefix (if it is non-empty) it is
// considered a direct file valma command. It's parent directory is made the initial "file" pool.
let poolBase = globalVargv.poolBase;
if ((_commandPrefix && (globalVargv.command || "").includes(_commandPrefix))
    || (globalVargv.command || "").slice(0, 2) === "./") {
  if (globalVargv.isCompleting) process.exit(0); // Let bash filename completion do its thing.
  const commandMatcher = new RegExp(`(.*/)?(\\.?)${_commandPrefix}(.*?)(.js)?$`);
  const match = globalVargv.command.match(commandMatcher);
  globalVargv.command = match ? `${match[2]}${match[3]}` : "";
  const filePoolPath = vlm.path.resolve((match && match[1]) || "");
  _availablePools.push({ name: "file", path: filePoolPath });
  poolBase = filePoolPath;
}
_availablePools.push(..._locateDependedPools(poolBase, globalVargv.poolDirectories));
_availablePools.push({ name: "global", path: globalVargv.globalPool });

vlm.ifVerbose(2)
    .expound("available pools:", _availablePools);

let _activePools = [];

const packageConfigStatus = {
  path: vlm.path.join(process.cwd(), "package.json"), updated: false,
};
const toolsetsConfigStatus = {
  path: vlm.path.join(process.cwd(), "toolsets.json"), updated: false,
};

vlm.contextVargv = globalVargv;
module.exports
    .handler(globalVargv)
    .then(result => {
      if (result !== undefined) {
        vlm.result(result);
        process.exit(0);
      }
    })
    .catch(error => {
      if (error !== undefined) {
        vlm.exception(error.stack || error);
      }
      process.exit(typeof error === "number" ? error : ((error && error.code) || -1));
    });

// Only function definitions from hereon.

async function handler (vargv, customVLM) {
  // Phase21: Pre-load args with so-far empty pools to detect fully builtin commands (which don't
  // need forwarding).
  const fullyBuiltin = vlm.isCompleting || !vargv.command;

  const needNPM = !fullyBuiltin && vargv.npmConfigEnv && !process.env.npm_package_name;
  const needVLMPath = !fullyBuiltin && !process.env.VLM_PATH;
  const needForward = !fullyBuiltin && needVLMPath;

  vlm.ifVerbose(1)
      .babble("phase 2, main:", "determine active commands, forwards, and do validations.",
          "\n\tfullyBuiltin:", fullyBuiltin, ", needNPM:", needNPM, ", needVLMPath:", needVLMPath,
              ", needForward:", needForward);

  // Phase 2: Load pools and forward to 'vlm' if needed (if a more specific 'vlm' is found or if the
  // node environment or 'vlm' needs to be loaded)
  const forwardPool = _refreshActivePools((pool, poolHasVLM, specificEnoughVLMSeen) => {
    vlm.ifVerbose(3)
        .babble(`evaluating pool ${pool.path}`, "has 'vlm':", poolHasVLM,
            "vlm seen:", specificEnoughVLMSeen);
    if (!globalVargv.forward || fullyBuiltin || !poolHasVLM
        || (specificEnoughVLMSeen && !needForward)
        || (!specificEnoughVLMSeen && !vargv.promote)) return undefined;
    Object.assign(process.env, {
      VLM_PATH: process.env.VLM_PATH || pool.path,
      VLM_GLOBAL_POOL: process.env.VLM_GLOBAL_POOL || globalVargv.globalPool,
      INIT_CWD: process.cwd(),
      PATH: `${[
        pool.path,
        _activePools[_activePools.length - 1].path,
        _activePools[0].path,
      ].join(":")}:${process.env.PATH}`,
      _: vlm.path.join(pool.path, "vlm"),
    });
    const myRealVLM = fs.realpathSync(process.argv[1]);
    pool.vlmPath = path.join(pool.path, "vlm");
    const forwardRealVLM = fs.realpathSync(pool.vlmPath);
    if (myRealVLM === forwardRealVLM) return undefined;
    vlm.ifVerbose(1)
        .info(`forwarding to vlm at require('${vlm.theme.path(pool.vlmPath)}')`,
            "via pool", vlm.theme.path(pool.path),
            "\n\treal path:", vlm.theme.path(forwardRealVLM), `(current vlm "${
                  vlm.theme.path(myRealVLM)})"`);
    return pool;
  });
  if (forwardPool) {
    // Call is handled by a forward require to another valma.
    process.argv[1] = forwardPool.vlmPath;
    require(forwardPool.vlmPath);
    return undefined;
  }
  if (needNPM) {
    await _loadNPMConfigVariables();
  }

  if (vlm.isCompleting) {
    vlm.contextVargv = globalVargv;
    vlm.invoke(vargv.command, vargv._);
    return null;
  }

  process.on("SIGINT", () => {
    vlm.exception("interrupted by SIGINT:", "killing all child processes");
    setTimeout(() => process.exit(-1));
  });
  process.on("SIGTERM", () => {
    vlm.exception("terminated by SIGINT:", "killing all child processes");
    setTimeout(() => process.exit(-1));
  });

  // Do validations.

  vlm.ifVerbose(2)
      .expound("activePools:",
          ...[].concat(..._activePools.map(pool => ["\n", Object.assign({}, pool, {
            listing: vlm.verbosity < 3
                ? "<hidden>"
                : Array.isArray(pool.listing) && pool.listing.map(entry => entry.name)
          })])),
          "\n");

  if (!fullyBuiltin && needVLMPath && !process.env.VLM_PATH) {
    vlm.error("could not find 'vlm' in PATH or in any pool");
    process.exit(-1);
  }

  if (!semver.satisfies(process.versions.node, nodeCheck)) {
    vlm.warn(`your node version is old (${process.versions.node}):`,
        "recommended to have at least", nodeCheck);
  }

  _reloadPackageAndToolsetsConfigs();

  if (!process.env.npm_config_user_agent) {
    if (needNPM && vlm.packageConfig) {
      vlm.warn("could not load NPM config environment variables");
    }
  } else {
    const npmVersion = (process.env.npm_config_user_agent || "").match(/npm\/([^ ]*) /);
    if (npmVersion && !semver.satisfies(npmVersion[1], npmCheck)) {
      vlm.warn(`your npm version is old (${npmVersion[1]})`,
          "recommended to have at least", npmCheck);
    }
  }

  const subVLM = Object.create(customVLM || vlm);
  subVLM.contextVargv = vargv;
  const maybeRet = subVLM.invoke(vargv.command, vargv._);
  subVLM.invoke = invokeWithEcho;
  const ret = await maybeRet;
  _flushPendingConfigWrites(vlm);
  return ret;
}

/*
                                #     #
  ####     ##    #       #      #     #    ##    #       #    #    ##
 #    #   #  #   #       #      #     #   #  #   #       ##  ##   #  #
 #       #    #  #       #      #     #  #    #  #       # ## #  #    #
 #       ######  #       #       #   #   ######  #       #    #  ######
 #    #  #    #  #       #        # #    #    #  #       #    #  #    #
  ####   #    #  ######  ######    #     #    #  ######  #    #  #    #
*/

async function invokeWithEcho (commandSelector, args) {
  // Remove everything after space so that exports.command can be given as commandSelector as-is
  // (they occasionally have yargs usage arguments after the command selector).
  const invokeVLM = Object.create(this);
  if (nextContextIndex !== undefined) invokeVLM.contextIndex = nextContextIndex++;
  const selector = commandSelector.split(" ")[0];
  const argv = _processArgs(args);
  invokeVLM.echo(`${this.getContextIndexText()}>> ${invokeVLM.getContextIndexText()}vlm`,
      this.theme.command(selector, ...argv));
  let echoResult;
  try {
    const ret = await invoke.call(invokeVLM, selector, argv);
    echoResult = invokeVLM.theme.blue((JSON.stringify(ret) || "undefined").slice(0, 71));
    return ret;
  } catch (error) {
    echoResult = invokeVLM.theme.error("exception:", String(error));
    throw error;
  } finally {
    invokeVLM.echo(`${this.getContextIndexText()}<< ${invokeVLM.getContextIndexText()}vlm`,
        `${vlm.theme.command(selector)}:`, echoResult);
  }
}

async function invoke (commandSelector, argv) {
  if (!Array.isArray(argv)) {
    throw new Error(`vlm.invoke: argv must be an array, got ${typeof argv}`);
  }
  if (!this || !this.ifVerbose) {
    throw new Error(`vlm.invoke: 'this' must be a valid vlm context`);
  }

  const contextVargv = this.contextVargv;
  const contextVLM = contextVargv.vlm;
  const commandGlob = _underToSlash((contextVargv.matchAll || this.isCompleting)
      ? _globFromPrefixSelector(commandSelector, contextVargv.matchAll)
      : _globFromExactSelector(commandSelector || "*"));
  const isWildcardCommand = !commandSelector || (commandSelector.indexOf("*") !== -1);
  const introspect = _determineIntrospection(
      module.exports, contextVargv, commandSelector, isWildcardCommand, true);

  // Phase 3: filter available command pools against the command glob

  this.ifVerbose(1)
      .babble("phase 3, invoke", this.theme.command(commandGlob, ...argv),
          "\n\tisWildcard:", isWildcardCommand, ", introspect options:", !!introspect);
  this.ifVerbose(2)
      .expound("introspect:", introspect)
      .expound("contextVargv:", { ...contextVargv, vlm: "<hidden>" });

  const activeCommands = _selectActiveCommands(this, _activePools, commandGlob, argv, introspect);

  if (this.isCompleting || contextVargv.bashCompletion) {
    globalVargs.completion("bash-completion", (current, argvSoFar) => {
      const rule = _underToSlash(_globFromPrefixSelector(argvSoFar._[1], argvSoFar.matchAll));
      const ret = [].concat(..._activePools.map(pool => pool.listing
          .filter(node => !_isDirectory(node) && minimatch(_underToSlash(node.name || ""), rule,
              { dot: argvSoFar.matchAll }))
          .map(node => _valmaCommandFromPath(node.name))));
      return ret;
    });
    _parse(globalVargs, contextVargv.bashCompletion ? ["bash-completion"] : process.argv.slice(2));
    return 0;
  }

  this.ifVerbose(2)
      .expound("activeCommands: {", ...Object.keys(activeCommands).map(
                key => `\n\t\t${key}: ${activeCommands[key].filePath}`),
          "\n\t}");

  if (introspect) {
    return _introspectCommands(globalVargs, introspect, activeCommands, commandGlob,
        isWildcardCommand, contextVargv.matchAll);
  }

  if (!isWildcardCommand && !Object.keys(activeCommands).length) {
    vlm.error(`cannot find command '${vlm.theme.command(commandSelector)}' from active pools:`,
        ..._activePools.map(activePool => `\n\t"${vlm.path.join(activePool.path, commandGlob)}"`));
    return -1;
  }

  // Phase 4: Dispatch the command(s)

  const dryRunCommands = contextVargv.dryRun && {};
  let ret = [];

  this.ifVerbose(1)
      .babble("phase 4, dispatch:", ...(dryRunCommands ? ["--dry-run"] : []),
          this.theme.command(commandGlob, ...argv),
          "\n\tactive commands:", ...Object.keys(activeCommands).map(c => vlm.theme.command(c)));
  globalVargs.help();

  // Reverse order to have matching global command names execute first (still obeying overrides)
  for (const activePool of _activePools.slice().reverse()) {
    for (const commandName of Object.keys(activePool.commands).sort()) {
      const activeCommand = activeCommands[commandName];
      if (!activeCommand) continue;
      const module = activeCommand.module;
      delete activeCommands[commandName];
      if (dryRunCommands) {
        dryRunCommands[commandName] = activeCommand;
        continue;
      }
      if (!module) {
        vlm.error(`missing symlink target for`, vlm.theme.command(commandName),
            "ignoring command script at", activeCommand.filePath);
        continue;
      }

      const subVLM = activeCommand.vlm;
      const subVargv = _parseUntilLastPositional(activeCommand.subVargs, argv, module.command,
          { vlm: subVLM });
      const subIntrospect = _determineIntrospection(module, subVargv, commandName);

      this.ifVerbose(3)
          .babble("parsed:", this.theme.command(commandName, ...argv),
              activeCommand.disabled ? `: disabled, ${activeCommand.disabled}` : ""
      ).ifVerbose(4)
          .expound("\tsubArgv:", subVargv)
          .expound("\tsubIntrospect:", subIntrospect);

      if (subIntrospect) {
        ret = ret.concat(_introspectCommands(activeCommand.subVargs,
            subIntrospect, { [commandName]: activeCommand }, commandSelector,
            isWildcardCommand, subVargv.matchAll));
      } else if (isWildcardCommand && activeCommand.disabled) {
        this.ifVerbose(1)
            .info(`Skipping disabled command '${this.theme.command(commandName)}'`,
                `during wildcard invokation (${activeCommand.disabled})`);
        continue;
      } else {
        if (activeCommand.disabled) {
          this.warn(`Invoking a disabled command '${commandName}' explicitly`,
              `(${activeCommand.disabled})`);
        }
        subVLM.contextVargv = subVargv;
        try {
          if (isWildcardCommand) {
            this.echo(`${contextVLM.getContextIndexText()}>>* ${subVLM.getContextIndexText()}vlm`,
                this.theme.command(commandName, ...argv));
          }
          await _tryInteractive(subVargv, activeCommand.subVargs);
          if (subVLM.toolset) {
            const requiresPath = ["commands", commandName, "requires"];
            const tool = subVLM.tool;
            const requires = tool
                ? subVLM.getToolConfig(subVLM.toolset, tool, ...requiresPath)
                : subVLM.getToolsetConfig(subVLM.toolset, ...requiresPath);
            let requireResult = true;
            for (let i = 0; requireResult && (i !== (requires || []).length); ++i) {
              const header = `tool${tool ? "Config" : "setConfig"}.requires[${i}] of ${
                this.theme.command(commandName)}`;
              try {
                this.echo(`${subVLM.getContextIndexText()}>>>? ${header}`, "via",
                    ...(tool ? ["tool", subVLM.colors.package(tool), "of"] : []),
                    "toolset", subVLM.colors.package(subVLM.toolset));
                requireResult = await subVLM.execute(requires[i]);
              } catch (error) {
                requireResult = subVLM.error(`<exception>: ${String(error)}`);
                throw error;
              } finally {
                this.echo(`${subVLM.getContextIndexText()}<<<? ${header}:`,
                    this.theme.blue(requireResult));
              }
              if (!requireResult) {
                const message = `'${this.theme.command(commandName)
                    }' as it can't satisfy requires[${i}]: ${this.theme.executable(requires[i])}`;
                if (!isWildcardCommand) {
                  throw new Error(`Failed command ${message}`);
                }
                this.error(`Skipping command ${message}`);
                ret.push(`Skipped command ${message}`);
              }
            }
            if (!requireResult) continue;
          }
          const simpleCommand = commandName.match(/\.?([^/]*)$/)[1];
          const detailCommandPrefix = commandName.replace(/.?[^/]*$/, `.${simpleCommand}`);
          const preCommands = `${detailCommandPrefix}/.pre/**/*`;
          if (subVLM.listMatchingCommands(preCommands).length) {
            await subVLM.invoke(preCommands);
          }
          ret.push(await module.handler(subVargv));
          const postCommands = `${detailCommandPrefix}/.post/**/*`;
          if (subVLM.listMatchingCommands(preCommands).length) {
            await subVLM.invoke(postCommands);
          }
        } finally {
          if (this.echo && (commandName !== commandSelector)) {
            let retValue = JSON.stringify(ret[ret.length - 1]);
            if (retValue === undefined) retValue = "undefined";
            if (isWildcardCommand) {
              this.echo(`${contextVLM.getContextIndexText()}<<* ${subVLM.getContextIndexText()}vlm`,
                  `${this.theme.command(commandName)}:`,
                  this.theme.blue(retValue.slice(0, 40), retValue.length > 40 ? "..." : ""));
            }
          }
        }
      }
    }
  }
  if (dryRunCommands) {
    _introspectCommands(globalVargs, _determineIntrospection(module, contextVargv),
        dryRunCommands, commandSelector, isWildcardCommand, contextVargv.matchAll);
  }
  return isWildcardCommand ? ret : ret[0];
}

/*
######
#     #  ######   #####    ##       #    #
#     #  #          #     #  #      #    #
#     #  #####      #    #    #     #    #
#     #  #          #    ######     #    #
#     #  #          #    #    #     #    #
######   ######     #    #    #     #    ######
*/

function _parse (vargs_, ...rest) {
  const ret = vargs_.parse(...rest);
  return ret;
}

function _parseUntilLastPositional (vargs_, argv_, commandUsage, context) {
  const endIndex = argv_.findIndex(arg => (arg === "--") || (arg[0] !== "-"));
  const args = argv_.slice(0, (endIndex === -1) ? undefined : endIndex);
  const ret = _parse(vargs_, args, context);
  const usageParts = commandUsage.split(" ");
  const positionals = usageParts.slice(1).filter(param => (param[1] !== "-"));
  ret._ = (endIndex === -1) ? [] : argv_.slice(endIndex);
  for (const positional of positionals) {
    const variadic = positional.match(/^.(.*)\.\..$/);
    if (variadic) {
      ret[variadic[1]] = ret._.splice(0, ret._.indexOf("--") + 1 || 100000);
      break;
    }
    ret[positional.slice(1, -1)] = ret._.shift();
  }
  ret.vlm = vargs_.vlm;
  return ret;
}

// eslint-disable-next-line no-bitwise
function _isDirectory (candidate) { return candidate.mode & 0x4000; }

// If the command begins with a dot, insert the command prefix _after_ the dot; this is useful
// as directories beginning with . don't match /**/ and * glob matchers and can be considered
// implementation detail.
function _globFromExactSelector (commandBody) {
  return !commandBody ? _commandPrefix
      : (commandBody[0] === ".") ? `.${_commandPrefix}${commandBody.slice(1)}`
      : `${_commandPrefix}${commandBody}`;
}

function _globFromPrefixSelector (partialCommand = "", matchAll) {
  return matchAll && !((partialCommand || "")[0] === ".")
      ? `{.,}${_commandPrefix}${partialCommand || ""}{,*/**/}*`
      : `${_globFromExactSelector(partialCommand)}{,*/**/}*`;
}

function _valmaCommandFromPath (pathname) {
  const match = pathname.match(new RegExp(`(\\.?)${_commandPrefix}(.*)`));
  return _underToSlash(`${match[1]}${match[2]}`);
}

function _underToSlash (text = "") {
  if (typeof text !== "string") throw new Error(`expected string, got: ${JSON.stringify(text)}`);
  return text.replace(/_/g, "/");
}

function _locateDependedPools (initialPoolBase, poolDirectories) {
  let pathBase = initialPoolBase;
  const ret = [];
  while (pathBase) {
    poolDirectories.forEach(candidate => {
      const poolPath = vlm.path.join(pathBase, candidate);
      if (shell.test("-d", poolPath)) {
        ret.push({ name: `${pathBase.match(/([^/]*)\/?$/)[1]}/${candidate}`, path: poolPath });
        return;
      }
      const packageJsonPath = vlm.path.join(pathBase, "package.json");
      if (candidate.match(/^node_modules/) && shell.test("-f", packageJsonPath)) {
        vlm.warn(`node_modules missing for ${packageJsonPath}!`,
            "\nSome dependent commands will likely be missing.",
            `Run '${colors.executable("yarn install")}' to make dependent commands available.\n`);
      }
    });
    if (pathBase === "/") break;
    pathBase = vlm.path.join(pathBase, "..");
  }
  return ret;
}

function _refreshActivePools (tryShortCircuit) {
  _activePools = [];
  let specificEnoughVLMSeen = false;
  for (const pool of _availablePools) {
    if (!pool.path || !shell.test("-d", pool.path)) continue;
    let poolHasVLM = false;
    pool.listing = shell.ls("-lAR", pool.path)
        .filter(file => {
          if (file.name.slice(0, 5) === "valma" || file.name.slice(0, 6) === ".valma") return true;
          if (file.name === "vlm") poolHasVLM = true;
          return false;
        });
    _activePools.push(pool);
    if (process.argv[1].indexOf(pool.path) === 0) specificEnoughVLMSeen = true;
    const shortCircuit = tryShortCircuit
        && tryShortCircuit(pool, poolHasVLM, specificEnoughVLMSeen);
    if (shortCircuit) return shortCircuit;
  }
  return undefined;
}

function _selectActiveCommands (contextVLM, activePools, commandGlob, argv, introspect) {
  if (introspect && introspect.identityPool) return introspect.identityPool.commands;
  const ret = {};
  for (const pool of activePools) {
    if (!pool.commands) pool.commands = {};
    pool.stats = {};
    pool.listing.forEach(file => {
      const normalizedName = _underToSlash(file.name);
      const matches = minimatch(normalizedName, commandGlob,
          { dot: contextVLM.contextVargv.matchAll });
      contextVLM.ifVerbose(3)
          .babble(`evaluating file ${file.name}`, "matches:", matches, "vs glob:", commandGlob,
          ", dir:", _isDirectory(file), ", normalizedName:", normalizedName);
      if (!matches) {
        pool.stats.nonmatching = (pool.stats.nonmatching || 0) + 1;
        return;
      }
      if (_isDirectory(file)) return;
      const commandName = _valmaCommandFromPath(file.name);
      const poolCommand = pool.commands[commandName] || (pool.commands[commandName] = {
        name: commandName, pool, file, filePath: vlm.path.join(pool.path, file.name),
      });
      if (ret[commandName]) {
        pool.stats.overridden = (pool.stats.overridden || 0) + 1;
        return;
      }
      if (!poolCommand.module && shell.test("-e", poolCommand.filePath)) {
        poolCommand.module = require(poolCommand.filePath);
        contextVLM.ifVerbose(3)
          .babble(`    command ${commandName} module found at path`, poolCommand.filePath);
      }
      const module = poolCommand.module;
      if (!module || !module.command || !module.describe || !module.handler) {
        if (vlm.isCompleting || introspect || contextVLM.contextVargv.dryRun) {
          ret[commandName] = { ...poolCommand };
          return;
        }
        throw new Error(`invalid command '${commandName}' script file '${poolCommand.filePath
            }': can't open for reading or exports.command, ...describe or ...handler missing`);
      }

      const subVargs = _createVargs(argv);
      _addUniversalOptions(subVargs, { global: true, hidden: !globalVargv.help });

      subVargs.vlm = Object.assign(Object.create(contextVLM), module.vlm,
          { contextCommand: commandName });
      if (nextContextIndex !== undefined) subVargs.vlm.contextIndex = nextContextIndex++;

      const activeCommand = ret[commandName] = {
        ...poolCommand,
        subVargs,
        vlm: subVargs.vlm,
        disabled: (module.disabled
            && ((typeof module.disabled !== "function")
                    ? `exports.disabled == ${String(module.disabled)}`
                : (module.disabled(subVargs)
                    && `exports.disabled => ${String(module.disabled(subVargs))}`))),
      };

      if (!module.builder || !module.builder(subVargs)) {
        if (!activeCommand.disabled) activeCommand.disabled = "exports.builder => falsy";
      }
      const exportedCommandName = module.command.match(/^([^ ]*)/)[1];
      if (exportedCommandName !== commandName) {
        contextVLM.warn(`Command name mismatch between exported command name '${
            contextVLM.colors.command(exportedCommandName)}' and command name '${
            contextVLM.colors.command(commandName)}' inferred from file:`, file.name);
      }

      subVargs.usage(module.command.replace(exportedCommandName, "$0"), module.describe);
      if (!activeCommand.disabled || contextVLM.contextVargv.matchAll) {
        globalVargs.command(module.command, module.describe,
            ...(!activeCommand.disabled && module.builder ? [module.builder] : []), () => {});
      } else {
        pool.stats.disabled = (pool.stats.disabled || 0) + 1;
      }
    });
  }
  return ret;
}

/**
 * Load all npm config variables to process.env as if running valma via 'npx -c'
 * FIXME(iridian): horribly broken.
 */
async function _loadNPMConfigVariables () {
  /*
  Broken: current implementation is a silly attempt - only npm config list -l --json options are
  loaded, omitting all npm_lifetime, npm_package_ config etc. options.
  A better overall solution to handling operations which need npm config might be to have valma
  commands explicitly specify that they need those commands but otherwise not load npm at all.
  A reliable method of achieving this is to call such commands with 'npx -c' (but it's still fing
  slow as it spawns node, npm and whatnot.
  Upside of current solution is that running "npm config list" is very fast, and can be optimized
  further too: npm can be programmatically invoked.
  */
  if (globalVargv.packageConfigEnv) {
    vlm.error("did not load npm_package_* variables (not implemented yet)");
  }
  Object.assign(process.env, {
    npm_execpath: "/usr/lib/node_modules/npm/bin/npm-cli.js",
    npm_lifecycle_event: "env",
    npm_lifecycle_script: "env",
    npm_node_execpath: "/usr/bin/node",
  });
  const execFile = util.promisify(childProcess.execFile);
  const { stdout, stderr } = await execFile("npm", ["config", "list", "-l", "--json"]);
  if (stderr) {
    vlm.error("leaving: can't load npm config with 'npm config list -l --json'");
    process.exit(-1);
  }
  const npmConfig = JSON.parse(stdout);
  for (const npmVariable of Object.keys(npmConfig)) {
    const value = npmConfig[npmVariable];
    process.env[`npm_config_${npmVariable.replace(/-/g, "_")}`] =
        typeof value === "string" ? value : "";
  }
}

function listMatchingCommands (commandSelector, matchAll = false) {
  const minimatcher = _underToSlash(_globFromExactSelector(commandSelector || "*"));
  const ret = [].concat(..._activePools.map(pool => pool.listing
      .map(file => _underToSlash(file.name))
      .filter(name => {
        const ret_ = minimatch(name, minimatcher, { dot: matchAll });
        return ret_;
      })
      .map(name => _valmaCommandFromPath(name))
  )).filter((v, i, a) => (a.indexOf(v) === i));
  this.ifVerbose(1)
      .expound(matchAll ? "listMatchingCommands:" : "listAllMatchingCommands:",
          this.theme.command(commandSelector),
          ...(this.verbosity > 1 ? [", minimatcher:", minimatcher] : []),
          "\n\tresults:", ret);
  return ret;
}

function listAllMatchingCommands (commandSelector) {
  return listMatchingCommands.call(this, commandSelector, true);
}

/**
 * Execute given executable as per child_process.spawn.
 * Extra spawnOptions:
 *   noDryRun: if true this call will be executed even if --dry-run is requested.
 *   dryRunReturn: during dry runs this call will return immediately with the value of this option.
 *
 * All argv must be strings, all non-strings and falsy values will be filtered out.
 *
 * @param {*} executable
 * @param {*} [argv=[]]
 * @param {*} [spawnOptions={}]
 * @returns
 */
async function execute (args, spawnOptions = {}) {
  const argv = _processArgs(args);
  if ((argv[0] === "vlm") && !Object.keys(spawnOptions).length) {
    argv.shift();
    return await module.exports.handler(
        _parseUntilLastPositional(globalVargs, argv, module.exports.command), this);
  }
  return new Promise((resolve, failure) => {
    _flushPendingConfigWrites(this);
    this.echo(`${this.getContextIndexText()}>>$`, `${this.theme.executable(...argv)}`);
    const _onDone = (code, signal) => {
      if (code || signal) {
        this.echo(`${this.getContextIndexText()}<<$`, `${this.theme.executable(argv[0])}:`,
        this.theme.error("<error>:", code || signal));
        failure(code || signal);
      } else {
        _refreshActivePools();
        _reloadPackageAndToolsetsConfigs();
        this.echo(`${this.getContextIndexText()}<<$`, `${this.theme.executable(argv[0])}:`,
            this.theme.warning("execute return values not implemented yet"));
        resolve();
      }
    };
    if (this.contextVargv && this.contextVargv.dryRun && !spawnOptions.noDryRun) {
      this.echo("      dry-run: skipping execution and returning:",
      this.theme.blue(spawnOptions.dryRunReturn || 0));
      _onDone(spawnOptions.dryRunReturn || 0);
    } else {
      const subProcess = childProcess.spawn(
          argv[0],
          argv.slice(1), {
            stdio: ["inherit", "inherit", "inherit"],
            ...spawnOptions,
            detached: true,
          },
      );
      subProcess.on("exit", _onDone);
      subProcess.on("error", _onDone);
      process.on("SIGINT", () => {
        this.warn("vlm killing:", this.theme.green(...argv));
        process.kill(-subProcess.pid, "SIGTERM");
        process.kill(-subProcess.pid, "SIGKILL");
      });
      process.on("SIGTERM", () => {
        this.warn("vlm killing:", this.theme.green(...argv));
        process.kill(-subProcess.pid, "SIGTERM");
        process.kill(-subProcess.pid, "SIGKILL");
      });
    }
  });
}

// All nulls and undefines are filtered out.
// Strings within zeroth and first nested levels are split by whitespace as separate arguments.
// Second nested level of arrays is stringification + direct catenation of entries with .join("").
// The contents of second and more levels of arrays are concatenated together as a single string.
// Booleans are filtered if not associated with a key, in which case they become a valueless --<key>
// or --no-<key> depending on the truthiness.
// Objects are expanded with as a sequence of "--<key>=<value>", where 'value' is passed through
// _processArgs recursively. Nest values containing whitespace twice or they will be split.
// Array values are expanded as sequence of "--<key>=<value1> --<key>=<value2> ...".
// type like so: ["y", { foo: "bar", val: true, nothing: null, neg: false, bar: ["xy", false, 0] }]
//            -> ["y", "--foo", "bar", "--val", "--no-neg", "--bar=xy", "--no-bar", "--bar=0"]
function _processArgs (args) {
  return [].concat(...[].concat(args).map(entry =>
    ((typeof entry === "string")
        ? entry.split(" ")
    : Array.isArray(entry)
        ? entry.map(e => ((typeof e === "string") ? e : JSON.stringify(e))).join("")
    : (!entry || (typeof entry !== "object"))
        ? _toArgString(entry)
        : [].concat(...Object.keys(entry).map(
            key => _toArgString(entry[key], key))))));

  function _toArgString (value, key) {
    if ((value === undefined) || (value === null)) return [];
    if (typeof value === "string") return !key ? value : [`--${key}=${value}`];
    if (typeof value === "boolean") return !key ? [] : value ? `--${key}` : `--no-${key}`;
    if (Array.isArray(value)) return [].concat(...value.map(entry => _toArgString(entry, key)));
    return JSON.stringify(value);
  }
}

function _determineIntrospection (module, vargv, selector, isWildcard, invokeEntry) {
  const ret = { module, show: {} };
  Object.keys(vargv).forEach(key => {
    if (vargv[key] && (key.slice(0, 5) === "show-")) ret.show[key.slice(5)] = vargv[key];
  });
  if ((globalVargv.help || vargv.help) && (!selector || !invokeEntry)) {
    return { module, builtinHelp: true };
  }
  ret.entryIntro = Object.keys(ret.show).length;

  if (selector && !ret.entryIntro) return undefined;
  if (!selector && ret.entryIntro && !vargv.dryRun && !vargv.matchAll) {
    // Introspect context
    ret.identityPool = { path: path.dirname(process.argv[1]), commands: {} };
    ret.identityPool.commands.vlm = {
      name: "vlm", module, filePath: __filename, pool: ret.identityPool,
    };
  }
  if (!selector && !ret.entryIntro) { // show default listing
    if (!vargv.dryRun) ret.defaultUsage = true;
    ret.show.usage = true;
    ret.show.description = true;
  }
  ret.displayHeaders = isWildcard && !ret.identityPool;
  if (!ret.show.name && !ret.show.usage) {
    if (!isWildcard && vargv.dryRun) ret.show.usage = true;
    else if (!ret.entryIntro) ret.show.name = true;
  }
  return ret;
}

function _introspectCommands (vargs_, introspect, commands_, commandGlob, isWildcard_, matchAll) {
  const theme = themes.default;
  if (introspect.builtinHelp) {
    vargs_.vlm = vlm;
    vargs_.$0 = theme.command(introspect.module.command.match(/^[^ ]*/)[0]);
    vargs_.showHelp("log");
    return [];
  }
  if (introspect.identityPool) {
    const poolIntro = _introspectPool(
        introspect.identityPool, false, false, introspect.identityPool.commands);
    if ((poolIntro[""] || {}).columns.length === 1) poolIntro[""].columns[0].hide = true;
    return poolIntro;
  }
  const chapters = { "": { chapters: true } };
  const pools = { "": { chapters: true, heading: { style: "bold" } } };
  _addLayoutOrderedProperty(chapters, "pools", pools);

  if (introspect.defaultUsage) {
    chapters.pools[""].heading.text = `${matchAll ? "All known" : "Visible"} commands by pool:`;
    if (!matchAll) {
      chapters[""].entries.unshift({
        usage: { heading: { style: "bold", text: `Usage: ${introspect.module.command}` } }
      });
      chapters.usage = "";
    }
  }
  for (const pool of [..._activePools].reverse()) {
    const poolIntro = _introspectPool(pool, isWildcard_, globalVargv.pools, commands_);
    _addLayoutOrderedProperty(pools, pool.name, poolIntro);
    const isEmpty = !Object.keys(poolIntro).filter(k => k).length;
    if (isWildcard_ && (!isEmpty || globalVargv.pools || matchAll)) {
      poolIntro[""].heading = {
        style: "bold",
        text: `${vlm.path.join(pool.name, commandGlob)} ${
            isEmpty ? "has no shown commands" : "commands:"} (${
                theme.info(Object.keys(pool.stats || {}).map(
                    s => `${s}: ${pool.stats[s]}`).join(", "))
            })`
      };
    } else if (isEmpty) {
      poolIntro[""].hide = true;
    }
  }
  if (isWildcard_) return chapters;
  const visiblePoolName = Object.keys(pools).find(key => key && !(pools[key][""] || {}).hide);
  if (!visiblePoolName) return undefined;
  const command = pools[visiblePoolName];
  const keys = Object.keys(command).filter(k => k);
  if (keys.length !== 1) return command;
  const ret = command[keys[0]];
  if (typeof ret !== "object" || !ret || Array.isArray(ret)) return ret;
  ret[""] = Object.assign(ret[""] || {}, { entries: (command[""] || {}).columns });
  return ret;

  function _introspectPool (pool, isWildcard, showOverridden, introedCommands) {
    const missingFile = "<file_missing>";
    const missingPackage = "<package_missing>";
    const poolIntro = { "": {
      stats: pool.stats,
      columns: [
        { name: { text: "command", style: "command" } },
        { usage: { style: "command" } },
        { description: { style: { default: missingPackage } } },
        { package: { style: "package" } },
        { version: { style: [{ default: missingPackage }, "version"] } },
        { pool: { text: "source pool" } },
        { file: { text: "script path", style: "path" } },
        { resolved: { text: "real file path", style: [{ default: missingFile }, "path"] } },
        { introduction: {
          oob: true, elementStyle: isWildcard && { prefix: "\n", suffix: "\n" }
        } },
        { source: { oob: true, elementStyle: "cardinal" } },
      ].filter(c => introspect.show[Object.keys(c)[0]]),
    } };
    const trivialKey = Object.keys(introspect.show).length === 1 && Object.keys(introspect.show)[0];
    Object.keys(pool.commands)
    .sort()
    .forEach(name => {
      const poolCommand = pool.commands[name];
      if (!poolCommand || !introedCommands[name]
          || (poolCommand.disabled && isWildcard && !matchAll)) return;
      const info = _commandInfo(poolCommand.filePath, pool.path);
      const module = poolCommand.module
          || (poolCommand.module = info.resolvedPath && require(info.resolvedPath));
      const rowData = { disabled: !!poolCommand.disabled };
      if (!module || !module.command) rowData.missing = true;
      if (poolCommand.disabled) rowData.disabled = true;
      if ((introedCommands[name] || { pool }).pool !== pool) {
        if (!showOverridden) return;
        rowData.overridden = true;
        rowData.entries = { name: { style: "overridden", }, usage: { style: "overridden " } };
      }
      const _addData = (property, data) => introspect.show[property] && (rowData[property] = data);
      _addData("name", poolCommand.disabled ? `(${name})` : name);
      _addData("usage", (module && module.command) || `${name} ${missingPackage}`);
      _addData("description", (module && module.describe) || missingPackage);
      _addData("package", info.package);
      _addData("version", info.version || missingPackage);
      _addData("pool", info.poolPath);
      _addData("file", info.filePath);
      _addData("resolved", info.resolvedPath || missingFile);
      if (introspect.show.introduction) {
        rowData.introduction = !module ? null : (module.introduction || module.describe);
        if (rowData.introduction === null) {
          vlm.warn(`Cannot read command '${name}' script introduction from:`, info.resolvedPath);
        }
      }
      if (introspect.show.source) {
        rowData.source = !module ? null : String(shell.head({ "-n": 1000000 }, info.resolvedPath));
        if (rowData.source === null) {
          vlm.warn(`Cannot read command '${name}' script source from:`, info.resolvedPath);
        }
      }
      poolIntro[name] = trivialKey ? rowData[trivialKey] : rowData;
    });
    return poolIntro;
  }
}

/**
 * Converts and returns the given value as a Github Formatted Markdown
 * string.
 *
 * Purpose of this tool two-fold: to make it possible to have all
 * github markdown documents as JSON objects and also to be able to
 * insert arbitrary tool output JSON values to be part of these
 * documents with minimal additional formatting code.
 *
 * The conversion is then a compromise of two principles:
 * 1. all non-surprising value structures produce non-surprising and
 *    intuitively structured and readable markdown string.
 * 2. any valid GHM output HTML can be produced using a combination of
 *    surprising value structures and inline entries.
 *
 * Tools which are not aware that their JSON output is gfmarkdownified
 * should not naturally or accidentally produce the surprising values.
 * An example of a surprising value structure is an array which
 * otherwise contains objects with only primitive values but the first
 * entry is an array - _toGFMarkdown uses the array to specify the
 * columns of a table.
 * Another example of surprising values are strings containing GFM
 * notation or HTML: these are /not/ escaped and translate as-is to the
 * GFM output string.
 *
 * Non-surprising production rules:
 * 1. Strings map as-is, numbers map JSON.stringify, null as "-" and
 *    undefined as "".
 * 2. Empty arrays [] and objects {} affect layout but they are removed
 *    from containing arrays and objects. Empty keys "" are removed.
 * 3. Innermost array (contains only primitive values) is " "-joined.
 *    All isolated singular newlines are removed (and rewritten later).
 * 4. Second and subsequent nesting arrays become numbered lists.
 *    Note: with production rule 2. lists can be enforced like so:
 *      numbered list: [[], "first entry", "second entry"]
 *      unordered list: [{}, "first entry", "second entry"]
 * 5. Isolated objects with primitive values are mapped as GFM tables
 *    with key and value columns properties as its two rows.
 * 6. Consequtive objects with primitive values are mapped as a single
 *    GFM table with the collection of all object keys as columns,
 *    objects as rows and object values as cells in the corresponding
 *    column.
 * 7. Objects with complex values are mapped into chapters with the
 *    object key as header. The deeper the nesting, the lower the
 *    emitted H tag. { "": [[[[[{}]]]]] }
 *
 * @param {*} value
 * @param {*} theme
 * @param {*} context
 * @returns
 */
function _toGFMarkdown (value, theme, context) {
  // https://github.github.com/gfm/#introduction
  return _renderBlock(_createBlockTree(value, context, theme), context, theme);
}

function _addLayoutOrderedProperty (target, name, entry, customLayout) {
  const targetLayout = target[""] || (target[""] = {});
  const entries = targetLayout.entries || (targetLayout.entries = []);
  entries.push(customLayout === undefined ? name : [name, customLayout]);
  target[name] = entry;
}

function _createBlockTree (value, contextBlock, theme) {
  const block = {
    value, type: "text", text: (value === undefined) ? ""
        : (value === null) ? "-"
        : (typeof value === "string") ? value
        : (typeof value === "number" || typeof value === "boolean") ? JSON.stringify(value)
        : undefined,
    height: 0, depth: ((contextBlock && contextBlock.depth) || 0) + 1,
  };
  if (typeof value === "function") {
    block.renderer = value;
  } else if (Array.isArray(value)) {
    block.type = "array";
    block.entryBlocks = value.map(e => _createBlockTree(e, block, theme));
    if (block.entryBlocks.findIndex(e => !e.empty) === -1) block.empty = true;
    else if (block.height > 1) {
      // Group entryBlocks into separate sections of blocks with the same type and height.
      block.sections = [];
      let info = { start: 0, height: 0, type: "" };
      block.entryBlocks.forEach((e, index) => {
        if (e.height !== info.height || e.type !== info.type) {
          if (index !== info.start) block.sections.push(block.entryBlocks.slice(info.start, index));
          info = { start: index, height: e.height, type: e.type };
        }
      });
      const section = block.entryBlocks.slice(info.start);
      if (section.length) block.sections.push(section);
    }
  } else if (block.text === undefined) {
    block.type = "object";
    if (value[""]) block.header = value[""];
    _extractEntries((block.header || {}).entries || [null],
        value, block.mappingKeyBlocks = [], block.mappingLayouts = {});
    if (!block.mappingKeyBlocks.findIndex(e => !e[1].empty) === -1) block.empty = true;
    if ((block.header || {}).columns) {
      _extractEntries((block.header || {}).columns,
          undefined, block.columnKeyBlocks = [], block.columnLayouts = {});
    }
  }
  if (contextBlock && contextBlock.height <= block.height) contextBlock.height = block.height + 1;
  return block;

  function _extractEntries (entry, presenceCheck, targetSequence, targetLayouts) {
    if (entry === undefined || entry === "") return;
    const selfRecurser = e => _extractEntries(e, presenceCheck, targetSequence, targetLayouts);
    if (entry === null) Object.keys(block.value).sort().forEach(selfRecurser);
    else if (Array.isArray(entry)) {
      if (entry.length === 2 && typeof entry[0] === "string" && typeof entry[1] === "object") {
        if ((!presenceCheck ||( value[entry[0]] !== undefined)) && !targetLayouts[entry[0]]) {
          targetSequence.push([entry[0], _createBlockTree(value[entry[0]], block, theme)]);
        }
        targetLayouts[entry[0]] = Object.assign(targetLayouts[entry[0]] || {}, entry[1]);
      } else {
        entry.forEach(selfRecurser);
      }
    } else if (typeof entry === "object") {
      Object.keys(entry).sort().map(key => [key, entry[key]]).forEach(selfRecurser);
    } else selfRecurser([String(entry), {}]);
  }
}

function _renderBlock (block, contextBlock, theme) {
  if ((block.header || {}).hide) return "";
  if (block.text !== undefined) return block.text;
  if (block.type === "object") {
    return ((block.height === 1) && !block.header)
        ? _renderTable(
            block.mappingKeyBlocks.map(m => ([
              m[0], { value: {}, mappingKeyBlocks: [["key", { text: m[0] }], ["value", m[1]]] }
            ])), {
              ...block,
              columnLayouts: { key: {}, value: {} },
              columnKeyBlocks: [["key", {}], ["value", {}]]
            }, theme)
        : (((block.height !== 2) || (block.header || {}).chapters)
            ? _renderChapters : _renderTable)(block.mappingKeyBlocks, block, theme);
  }
  if (block.type === "array") {
    if (block.height === 1) return block.value.join(" ");
    if ((block.height === 2) && ((block.sections || []).length <= 2)
        && block.sections[block.sections.length - 1][0].type === "object") {
      const header = (block.sections.length === 2) && block.sections[0];
      const blocks = block.sections[block.sections.length - 1];
      return _renderTable(blocks.map((b, index) => ([index, b])), { ...block, ...header }, theme);
    }
    // TODO(iridian): Add lists etc.
    return block.entryBlocks.map(entryBlock => _renderBlock(entryBlock, block, theme)).join("\n");
  }
  vlm.error("Cannot find renderer function for entry:",
      (JSON.stringify(block, null, 2) || "").replace(/\n/g, "\n    "));
  vlm.error("Inside context:",
      (JSON.stringify(contextBlock, null, 2) || "").replace(/\n/g, "\n   "));
  throw new Error("can't render");
}

function _renderChapters (chapterKeyBlocks, block, sectionTheme) {
  const retRows = [];
  chapterKeyBlocks.forEach(([key, chapterBlock]) => {
    const layout = Object.assign({ heading: { text: key, style: "bold" } },
        chapterBlock.header, (block.mappingLayouts || {})[key]);
    if (layout.hide) return;
    if ((layout.heading || {}).text) {
      retRows.push(sectionTheme.decorate([layout.heading.style, { heading: block.depth }])(
          layout.heading.text));
    }
    const chapterText = _renderBlock(chapterBlock, block, sectionTheme);
    const style = layout.elementStyle || layout.style;
    retRows.push(!style ? chapterText : sectionTheme.decorate(style)(chapterText));
  });
  return retRows.join("\n");
}


function _renderTable (rowKeyBlocks, tableBlock, tableTheme) {
  const _cvalue = (block, column) => (((typeof block.value !== "object") ? [0, block]
      : block.mappingKeyBlocks.find(([key]) => (key === column)) || [0, { text: "" }])[1].text);
  const _espipe = (v) => (v && v.replace(/\|/g, "\\|")) || "";
  let { columnKeyBlocks, columnLayouts } = tableBlock;
  if (!columnKeyBlocks) {
    columnKeyBlocks = [];
    columnLayouts = {};
    rowKeyBlocks.forEach(([, block]) => block.mappingKeyBlocks.forEach(([elementKey]) => {
      if (!columnLayouts[elementKey]) {
        columnLayouts[elementKey] = {};
        columnKeyBlocks.push([elementKey, columnLayouts[elementKey]]);
      }
    }));
  }
  columnKeyBlocks.forEach(([name, layout], index_) => {
    const c = Object.assign({}, (tableTheme.headers || {})[name], columnLayouts[name]);
    columnKeyBlocks[index_] = [name, c];
    if (!c.style) c.style = ((...rest) => rest.join(""));
    if (!c.headerStyle) c.headerStyle = c.style;
    if (!c.getHeaderStyle) c.getHeaderStyle = (/* c, tableTheme */) => c.headerStyle;
    if (!c.elementStyle) c.elementStyle = c.style;
    if (!c.getElementStyle) c.getElementStyle = (/* row, c, tableTheme */) => c.elementStyle;
    if (c.oob) return;
    c.width = Math.max(3, (c.text || name).length,
        ...rowKeyBlocks.map(([, block]) => _espipe(_cvalue(block, name)).length));
  });
  const retRows = [];
  if (columnKeyBlocks && !(tableBlock.header || {}).hide) {
    retRows.push(columnKeyBlocks.map(([name, c]) => _renderElement(
        _espipe(c.text || name), c.width, c.getHeaderStyle(c, tableTheme))));
    retRows.push(columnKeyBlocks.map(
      ([, c]) => `${(c.align || "right") !== "right" ? ":" : "-"}${
            "-".repeat(c.width - 2)}${(c.align || "left") !== "left" ? ":" : "-"}`));
  }
  retRows.push(...rowKeyBlocks.map(([, block]) => columnKeyBlocks.map(([name, c]) => {
    const elementBlock = (block.columnLayouts || {})[name] || {};
    const elementText = _cvalue(block, name);
    return _renderElement(!c.oob ? _espipe(elementText) : elementText, c.width,
        elementBlock.style || c.getElementStyle(block, c, tableTheme));
  })));
  return retRows.map(r => r.join("|")).join("\n");

  function _renderElement (text_, width = 0, style = (i => i)) {
    const text = (typeof text_ === "string") ? text_ : `<${typeof text_}>`;
    const pad = width - text.length;
    return `${tableTheme.decorate(style)(text)}${" ".repeat(pad < 0 ? 0 : pad)}`;
  }
}

/*
function _layoutSectionText (text, width = 71) {
  return text.replace(/([^\n])\n([^\n])/g, "$1$2").split(/(\n*)/).map(t => {
    if (t[0] === "\n") return t;
    const words = t.split(/( *)/);
    let charCount = 0;
    words.forEach((word, index) => {
      charCount += word.length;
      if (charCount <= width) return;
      if (word[0] === " ") {
        words[index] = "\n";
        charCount = 0;
        return;
      }
      if (charCount === word.length) return; // long word: let next whitespace clear things up
      words[index - 1] = "\n";
      charCount = word.length;
      return;
    });
    return words.join("");
  }).join("");
}
*/

function _commandInfo (filePath, poolPath) {
  const ret = { filePath, poolPath };
  if (!filePath || !shell.test("-e", filePath)) return ret;
  ret.resolvedPath = fs.realpathSync(filePath);
  let remaining = path.dirname(ret.resolvedPath);
  while (remaining !== "/") {
    const packagePath = vlm.path.join(remaining, "package.json");
    if (shell.test("-f", packagePath)) {
      const packageJson = JSON.parse(shell.head({ "-n": 1000000 }, packagePath));
      return { ...ret, version: packageJson.version, package: packageJson.name };
    }
    remaining = vlm.path.join(remaining, "..");
  }
  return ret;
}

async function _tryInteractive (subVargv, subYargs) {
  const interactiveOptions = subYargs.getOptions().interactive;
  if (!vlm.interactive || !interactiveOptions) return subVargv;
  delete subYargs.getOptions().interactive;
  const questions = [];
  for (const optionName of Object.keys(interactiveOptions)) {
    const option = interactiveOptions[optionName];
    const question = Object.assign({}, option.interactive);
    if (question.when !== "always") {
      if ((question.when !== "if-undefined") || (typeof subVargv[optionName] !== "undefined")) {
        continue;
      }
    }
    delete question.when;
    if (!question.name) question.name = optionName;
    if (!question.message) question.message = option.description;
    if (!question.choices && option.choices) question.choices = [...option.choices];
    if (option.default !== undefined) {
      if (!["list", "checkbox"].includes(question.type)) {
        question.default = option.default;
      } else {
        const oldChoices = [];
        (Array.isArray(option.default) ? option.default : [option.default]).forEach(default_ => {
          if (!question.choices || !question.choices.includes(default_)) oldChoices.push(default_);
        });
        question.choices = oldChoices.concat(question.choices || []);
        if (question.type === "list") {
          question.default = question.choices.indexOf(option.default);
        } else if (question.type === "checkbox") {
          question.default = option.default;
        }
      }
    }
    // if (!question.validate) ...;
    // if (!question.transformer) ...;
    // if (!question.pageSize) ...;
    // if (!question.prefix) ...;
    // if (!question.suffix) ...;
    questions.push(question);
  }
  if (!Object.keys(questions).length) return subVargv;
  const answers = {};
  for (const question of questions) {
    do {
      Object.assign(answers, await vlm.inquire([question]));
    } while (question.confirm && !await question.confirm(answers[question.name], answers));
  }
  // FIXME(iridian): handle de-hyphenations, camelcases etc. all other option variants.
  // Now only updating the verbatim option.
  return Object.assign(subVargv, answers);
}


function _reloadPackageAndToolsetsConfigs () {
  if (shell.test("-f", packageConfigStatus.path)) {
    try {
      vlm.packageConfig = JSON.parse(shell.head({ "-n": 1000000 }, packageConfigStatus.path));
      _deepFreeze(vlm.packageConfig);
    } catch (error) {
      vlm.exception(String(error), `while reading ${packageConfigStatus.path}`);
      throw error;
    }
  }
  if (shell.test("-f", toolsetsConfigStatus.path)) {
    try {
      vlm.toolsetsConfig = JSON.parse(shell.head({ "-n": 1000000 }, toolsetsConfigStatus.path));
      _deepFreeze(vlm.toolsetsConfig);
    } catch (error) {
      vlm.exception(String(error), `while reading ${packageConfigStatus.path}`);
      throw error;
    }
  }
}

function getPackageConfig (...keys) { return _getConfigAtPath(this.packageConfig, keys); }
function getToolsetsConfig (...keys) { return _getConfigAtPath(this.toolsetsConfig, keys); }
function getValmaConfig (...keys) { return _getConfigAtPath(this.toolsetsConfig, keys); }

function _getConfigAtPath (root, keys) {
  return [].concat(...keys)
      .filter(key => (key !== undefined))
      .reduce((result, key) => ((result && (typeof result === "object")) ? result[key] : undefined),
          root);
}

function updatePackageConfig (updates) {
  if (typeof updates !== "object" || !updates) {
    throw new Error(`Invalid arguments for updatePackageConfig, expexted object, got ${
        typeof update}`);
  }
  if (!vlm.packageConfig) {
    throw new Error("vlm.updatePackageConfig: cannot update package.json as it doesn't exist");
  }
  const updatedConfig = _deepAssign(vlm.packageConfig, updates);
  if (updatedConfig !== vlm.packageConfig) {
    packageConfigStatus.updated = true;
    vlm.packageConfig = updatedConfig;
    vlm.ifVerbose(1)
        .info("package.json updated:", updates);
  }
}

function updateToolsetsConfig (updates) {
  if (typeof updates !== "object" || !updates) {
    throw new Error(`Invalid arguments for updateToolsetsConfig, expexted object, got ${
        typeof update}`);
  }
  if (!vlm.toolsetsConfig) {
    vlm.toolsetsConfig = {};
    toolsetsConfigStatus.updated = true;
  }
  const updatedConfig = _deepAssign(vlm.toolsetsConfig, updates);
  if (updatedConfig !== vlm.toolsetsConfig) {
    toolsetsConfigStatus.updated = true;
    vlm.toolsetsConfig = updatedConfig;
    vlm.ifVerbose(1)
        .info("toolsets.json updated:", updates);
  }
}

// Toolset vlm functions

function getToolsetConfig (toolsetName, ...rest) {
  if (typeof toolsetName !== "string" || !toolsetName) {
    throw new Error(`Invalid arguments for getToolsetConfig, expexted string|..., got ${
        typeof toolsetName}`);
  }
  return this.getToolsetsConfig(toolsetName, ...rest);
}

function getToolConfig (toolsetName, toolName, ...rest) {
  if (typeof toolsetName !== "string" || typeof toolName !== "string"
      || !toolsetName || !toolName) {
    throw new Error(`Invalid arguments for getToolConfig, expexted string|string|..., got ${
        typeof toolsetName}|${typeof toolName}`);
  }
  return this.getToolsetsConfig(toolsetName, "tools", toolName, ...rest);
}

function confirmToolsetExists (toolsetName) {
  if (this.getToolsetConfig(toolsetName)) return true;
  this.warn(`Cannot find toolset '${toolsetName}' from configured toolsets:`,
      Object.keys(this.getToolsetsConfig() || {}).join(", "));
  return false;
}

function updateToolsetConfig (toolsetName, updates) {
  if (typeof toolsetName !== "string" || typeof updates !== "object" || !toolsetName || !updates) {
    throw new Error(`Invalid arguments for updateToolsetConfig, expexted string|object, got ${
        typeof toolsetName}|${typeof updates}`);
  }
  return this.updateToolsetsConfig({ [toolsetName]: updates });
}

function updateToolConfig (toolsetName, toolName, updates) {
  if (typeof toolsetName !== "string" || typeof toolName !== "string" || typeof updates !== "object"
      || !toolsetName || !toolName || !updates) {
    throw new Error(`Invalid arguments for updateToolConfig, expexted string|string|object, got ${
        typeof toolsetName}|${typeof toolName}|${typeof updates}`);
  }
  return this.updateToolsetsConfig({ [toolsetName]: { tools: { [toolName]: updates } } });
}

function createStandardToolsetOption (description) {
  return {
    type: "string", default: this.toolset,
    description,
    interactive: {
      type: "input", when: "if-undefined",
      confirm: value => this.confirmToolsetExists(value),
    },
  };
}


function _deepFreeze (object) {
  if (typeof object !== "object" || !object) return;
  Object.freeze(object);
  Object.values(object).forEach(_deepFreeze);
}

function _deepAssign (target, source) {
  if (typeof source === "undefined") return target;
  if (Array.isArray(target)) return target.concat(source);
  if ((typeof source !== "object") || (source === null)
      || (typeof target !== "object") || (target === null)) return source;
  let objectTarget = target;
  Object.keys(source).forEach(sourceKey => {
    const newValue = _deepAssign(target[sourceKey], source[sourceKey]);
    if (newValue !== objectTarget[sourceKey]) {
      if (objectTarget === target) objectTarget = { ...target };
      objectTarget[sourceKey] = newValue;
    }
  });
  return objectTarget;
}

function _flushPendingConfigWrites () {
  _commitUpdates("toolsets.json", toolsetsConfigStatus, () => vlm.toolsetsConfig);
  _commitUpdates("package.json", packageConfigStatus, () => {
    const reorderedConfig = {};
    reorderedConfig.name = vlm.packageConfig.name;
    reorderedConfig.version = vlm.packageConfig.version;
    if (vlm.packageConfig.valaa !== undefined) reorderedConfig.valaa = vlm.packageConfig.valaa;
    Object.keys(vlm.packageConfig).forEach(key => {
      if (reorderedConfig[key] === undefined) reorderedConfig[key] = vlm.packageConfig[key];
    });
    return reorderedConfig;
  });
}

function _commitUpdates (filename, configStatus, createUpdatedConfig) {
  if (!configStatus.updated) return;
  if (vlm.contextVargv && vlm.contextVargv.dryRun) {
    vlm.info(`commit '${filename}' updates --dry-run:`, "not committing queued updates to file");
    return;
  }
  const configString = JSON.stringify(createUpdatedConfig(), null, 2);
  shell.ShellString(`${configString}\n`).to(configStatus.path);
  vlm.ifVerbose(1)
      .info(`committed '${filename}' updates to file:`);
  configStatus.updated = false;
}

function _createVargs (args, cwd = process.cwd()) {
  // Get a proper, clean yargs instance for neat extending.
  const ret = yargs(args, cwd, require);

  // Extend option/options with:
  //   interactive
  //   causes
  const baseOptions = ret.options;
  ret.option = ret.options = function valmaOptions (opt, attributes_) {
    if (typeof opt === "object") { // Let yargs expand the options object
      baseOptions.call(this, opt, attributes_);
      return this;
    }
    const attributes = { ...attributes_ };
    const optionState = this.getOptions();
    if (attributes.interactive) {
      if (!optionState.interactive) optionState.interactive = {};
      optionState.interactive[opt] = attributes;
    }
    if (attributes.causes) {
      if (!optionState.causes) optionState.causes = {};
      optionState.causes[opt] = attributes.causes;
    }
    const subVLM = this.vlm;
    if (subVLM && subVLM.toolset) {
      const subPath = ["commands", subVLM.contextCommand, "options", opt];
      let default_ = subVLM.tool && subVLM.getToolConfig(subVLM.toolset, subVLM.tool, ...subPath);
      if (default_ === undefined) default_ = subVLM.getToolsetConfig(subVLM.toolset, ...subPath);
      if (default_ !== undefined) attributes.default = default_;
    }
    if (attributes.default && attributes.choices) {
      attributes.choices =
          (Array.isArray(attributes.default) ? attributes.default : [attributes.default])
            .filter(defaultValue => !attributes.choices.includes(defaultValue))
            .concat(attributes.choices);
    }
    baseOptions.call(this, opt, attributes);
    return this;
  };

  // Extend parse with:
  //   causes
  const baseParse = ret.parse;
  ret.parse = function valmaParse (...rest) {
    const vargv = baseParse.apply(this, rest);
    const options = this.getOptions();
    let effects = [];
    for (const cause of Object.keys(options.causes || {})) {
      effects = effects.concat(_consequences(vargv[cause], options.causes[cause]));
    }
    function _consequences (reason, causes) {
      if (!reason) return [];
      if (typeof causes === "string") return [`--${causes}`];
      if (Array.isArray(causes)) {
        return [].concat(...causes.map(cause => _consequences(reason, cause)));
      }
      return [];
    }
    if (effects.length) {
      const { argv } = yargsParser(effects, { ...options });
      for (const effect of Object.keys(argv)) {
        const defaultValue = options.default[effect];
        if (effect !== "_" && (argv[effect] !== vargv[effect]) && (argv[effect] !== defaultValue)
            && (argv[effect] || (defaultValue !== undefined))) {
          if (defaultValue && (vargv[effect] !== defaultValue)) {
            throw new Error(`Conflicting effect '${effect}' has its default value '${defaultValue
                }' explicitly set to '${vargv[effect]}' and caused to '${argv[effect]}'`);
          }
          vargv[effect] = argv[effect];
        }
      }
    }
    return vargv;
  };
  return ret;
}
