const { extractee: { aggregate, em, ref, strong } } = require("@valos/vdoc");

module.exports = {
  /**
   * Construct ReSpec authors section based on the @valos/type-vault
   * valma configuration of the current working directory.
   *
   * @param {*} authorNames
   * @returns
   */
  authors (...authorNames) {
    const toolsetsPath = `${process.cwd()}/toolsets.json`;
    const authorLookup = (((require(toolsetsPath)["@valos/type-vault"] || {})
        .tools || {}).docs || {}).authors || {};
    return (authorNames || []).map(authorName => {
      const author = authorLookup[authorName];
      if (!author) {
        throw new Error(`Cannot find author '${authorName}' from toolsetConfig("${
          toolsetsPath}")["@valos/type-vault"].tools.docs.authors`);
      }
      return author;
    });
  },

  /**
   * Construct revdoc:dfn element.
   *
   * @param {*} text
   * @param {*} definitionId
   * @param {*} explanation
   * @returns
   */
  dfn (text, definitionId, ...explanation) {
    return aggregate({
      "revdoc:dfn": definitionId,
      "vdoc:content": [strong(ref(text, definitionId))],
    }, "vdoc:content", ...explanation);
  },

  /**
   * Construct revdoc:Package reference element.
   *
   * @param {*} packageName
   * @param {*} rest
   * @returns
   */
  pkg (packageName, ...rest) {
    return {
      ...ref(em(packageName), packageName, ...rest),
      "@type": "revdoc:Package",
    };
  },

  /**
   * Construct revdoc:Command element.
   *
   * @param {*} parts
   * @returns
   */
  command (...parts) {
    return {
      "@type": "revdoc:Command",
      "vdoc:words": [].concat(...parts.map(
              part => (typeof part !== "string" ? [part] : part.split(/(\s+)/))))
          .filter(w => (typeof w !== "string") || !w.match(/^\s+$/)),
    };
  },

  /**
   * Construct revdoc:CommandLineInteraction rows element.
   *
   * @param {*} rows
   * @returns
   */
  cli (...rows) {
    const commandedRows = rows.map(line => ((typeof line !== "string")
        ? line
        : module.exports.command(line)));
    let currentContext = "";
    const contextedRows = [];
    for (const row of commandedRows) {
      if ((row != null) && (row["@type"] === "vdoc:ContextBase")) {
        currentContext = row;
      } else {
        contextedRows.push([currentContext, "$ ", row]);
      }
    }
    return {
      "@type": "revdoc:CommandLineInteraction",
      "vdoc:entries": contextedRows,
    };
  },

  filterKeysWithAnyOf (entryFieldName, searchedValueOrValues = [], container) {
    return filterKeysWithFieldReduction(entryFieldName, searchedValueOrValues, container,
        (a, [field, searched]) => a || field.includes(searched));
  },

  filterKeysWithAllOf (entryFieldName, searchedValueOrValues = [], container) {
    return filterKeysWithFieldReduction(entryFieldName, searchedValueOrValues, container,
        (a, [field, searched]) => a && field.includes(searched), true);
  },

  filterKeysWithNoneOf (entryFieldName, searchedValueOrValues = [], container) {
    return filterKeysWithFieldReduction(entryFieldName, searchedValueOrValues, container,
        (a, [field, searched]) => a && !field.includes(searched), true);
  },

  filterKeysWithFieldReduction,
};

function filterKeysWithFieldReduction (entryFieldName, searchedValueOrValues, container,
    reduction, initial) {
  const searchedValues = [].concat(
      searchedValueOrValues !== undefined ? searchedValueOrValues : []);
  return Object.entries(container)
      .filter(([, entry]) => searchedValues
          .reduce((a, searchedValue) => reduction(a, [
            [].concat(entry[entryFieldName] !== undefined ? entry[entryFieldName] : []),
            searchedValue,
          ]), initial))
      .map(([key]) => key);
}