const vdoc = require("@valos/vdoc");

module.exports = {
  extension: {
    ...vdoc.extension,
    extends: [vdoc.extension],
    ontology: require("./ontology"),
    extractors: require("./extractors"),
    emitters: require("./emitters"),
    extractee: {},
  },
};