module.exports = {
  base: require("@valos/valk/VValk"),
  extenderModule: "@valos/raem/VValk",
  namespaceModules: {
    V: "@valos/kernel/V",
  },
  vocabulary: {
    ...require("./resolvers"),
  },
};
