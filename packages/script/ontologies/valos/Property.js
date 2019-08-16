module.exports = {
  ScriptProperty: {
    "@type": "valos-raem:Type",
    "rdfs:subClassOf": ["valos:Resource", "valos:Sourced", "rdf:Statement"],
    "revdoc:brief": "valoscript property",
    "rdfs:comment":
`The class of valospace Property resources which are expressed as
valoscript object properties.`,
  },

  scope: {
    "@type": "valos-raem:AliasField",
    "valos-raem:aliasOf": "valos:owner",
    "rdfs:subPropertyOf": "valos:owner",
    "rdfs:domain": "valos:ScriptProperty",
    "rdfs:range": "valos:Scope",
    restriction: { "@type": "owl:Restriction", "owl:maxCardinality": 1 },
    "valos-raem:isOwnedBy": true,
    "valos-raem:coupledField": "valos:properties",
    "rdfs:comment":
`The scope resource (and owner) of this ScriptProperty`,
  },

  value: {
    "@type": "valos-raem:PrimaryField",
    "rdfs:domain": "valos:ScriptProperty",
    "rdfs:range": "rdfs:Resource",
    restriction: { "@type": "owl:Restriction", "owl:maxCardinality": 1 },
    "valos-raem:initialValue": null,
    "valos-raem:finalDefaultValue": ["§void"],
    "rdfs:comment":
`The value of this ScriptProperty`,
  },

  // Hypertwin triple reification

  twinspace: {
    "@type": "valos-raem:GeneratedField",
    "rdfs:domain": "valos:ScriptProperty",
    "rdfs:range": "rdfs:Resource",
    restriction: { "@type": "owl:Restriction", "owl:maxCardinality": 1 },
    "valos-raem:generator": "getTwinspace",
    "rdfs:comment":
`The twinspace of this ScriptProperty. Equates to the expanded prefix
of the valos:name of this ScriptProperty using the context of this
partition. Additionally if the local part of the valos:name is an empty
string then the valos:value of this ScriptProperty defines
the twinspace id of the scope resource for this twinspace.`,
  },

  subject: {
    "@type": "valos-raem:GeneratedField",
    "rdfs:subPropertyOf": "rdf:subject",
    "rdfs:domain": "valos:ScriptProperty",
    "rdfs:range": "rdfs:Resource",
    restriction: { "@type": "owl:Restriction", "owl:maxCardinality": 1 },
    "valos-raem:generator": "getSubject",
    "rdfs:comment":
`The subject of this ScriptProperty when interpreted as a reified
rdf:Statement. Equates to the twinspace id of the scope resource using
the valos:twinspace of this ScriptProperty.`,
  },

  predicate: {
    "@type": "valos-raem:GeneratedField",
    "rdfs:subPropertyOf": "rdf:predicate",
    "rdfs:domain": "valos:ScriptProperty",
    "rdfs:range": "rdfs:Resource",
    restriction: { "@type": "owl:Restriction", "owl:maxCardinality": 1 },
    "valos-raem:generator": "getPredicate",
    "rdfs:comment":
`The subject of this ScriptProperty when interpreted as a reified
rdf:Statement. Equates to the IRI expansion of valos:name of this
ScriptProperty using the context of this partition.`,
  },

  object: {
    "@type": "valos-raem:AliasField",
    "valos-raem:aliasOf": "valos:value",
    "rdfs:subPropertyOf": "rdf:object",
    "rdfs:domain": "valos:ScriptProperty",
    "rdfs:range": "rdfs:Resource",
    restriction: { "@type": "owl:Restriction", "owl:maxCardinality": 1 },
    "rdfs:comment":
`The subject of this ScriptProperty when interpreted as a reified
rdf:Statement. Equates to the twinspace id of the valos:value using
the valos:twinspace of this ScriptProperty if one is defined. Otherwise
equals to the valos:value itself.
`,
  },
};
