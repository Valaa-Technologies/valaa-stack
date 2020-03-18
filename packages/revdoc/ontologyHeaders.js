const { extractee: { em, ref, strong } } = require("@valos/vdoc");

const prefixes = {
  "header#0;vdoc:selectKey": "Prefix",
  "header#1;vdoc:selectValue": "IRI",
};

const vocabulary = {
  "header#0": {
    "vdoc:content": ["rdfs:label"],
    "vdoc:cell": {
      "vdoc:resourceId": "vdoc:selectKey",
      ...ref(em("vdoc:selectKey"), ["#", "vdoc:selectKey"]),
    },
  },
  "header#9;rdfs:comment": {
    "vdoc:content": em("rdfs:comment"),
    "vdoc:wide": true,
  },
};

const context = {
  "header#0;vdoc:selectKey": "Term",
  "header#1;vdoc:selectValue": "Definition",
  "header#2;@id": "@id",
  "header#3;@type": "@type",
  "header#4;@container": "@container",
};

const classes = {
  ...vocabulary,
  "header#1": {
    "vdoc:content": ["rdfs:subClassOf"],
    "vdoc:cell": { "vdoc:words": { "vdoc:selectField": "rdfs:subClassOf" } },
  },
};

const properties = {
  ...vocabulary,
  "header#1;rdfs:subPropertyOf": "rdfs:subPropertyOf",
  "header#2;rdfs:domain": "rdfs:domain",
  "header#3;rdfs:range": "rdfs:range",
};

const elements = {
  ...vocabulary,
};

const types = {
  ...vocabulary,
  "header#1": {
    "vdoc:content": ["revdoc:brief"],
    "vdoc:cell": strong({ "vdoc:selectField": "revdoc:brief" }),
  },
  "header#2": {
    "vdoc:content": ["rdfs:subClassOf"],
    "vdoc:cell": { "vdoc:words": { "vdoc:selectField": "rdfs:subClassOf" } },
  },
};

const fields = {
  ...vocabulary,
  "header#1;rdfs:domain": "rdfs:domain",
  "header#2;rdfs:range": "rdfs:range",
  "header#3;@type": "rdf:type",
  "header#4;rdfs:subPropertyOf": "rdfs:subPropertyOf",
  "header#5;valos_raem:coupledField": "valos_raem:coupledField",
};

const verbs = {
  ...vocabulary,
  "header#1;@type": "rdf:type",
  "header#2;comment": "Comment",
};

const vocabularyOther = {
  ...vocabulary,
  "header#1;@type": "rdf:type",
  "header#2": {
    "vdoc:content": ["rdfs:subClassOf"],
    "vdoc:cell": { "vdoc:words": { "vdoc:selectField": "rdfs:subClassOf" } },
  },
};

const extractionRules = {
  "header#0;vdoc:selectKey": "Rule name",
  "header#1;range": "Inter-node rdf:type",
  "header#2;owner": "Owner property",
  "header#3;body": "Body property",
  "header#4;rest": "';rest' property",
  "header#5;comment": "Comment",
};

const extractee = {
  "header#0;vdoc:selectKey": "API identifier",
  "header#1;vdoc:selectValue": "rdf:type",
};

module.exports = {
  prefixes,

  vocabulary,
  classes,
  properties,
  elements,
  types,
  fields,
  verbs,
  vocabularyOther,

  extractionRules,
  extractee,

  context,
};
