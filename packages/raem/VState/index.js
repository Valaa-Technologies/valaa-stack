const { ref } = require("@valos/revdoc/extractee");

module.exports = {
  base: require("@valos/state/VState"),
  extenderModule: "@valos/raem/VState",
  namespaceModules: {
    VKernel: "@valos/kernel/VKernel",
    V: "@valos/space/V",
  },
  vocabulary: {
    ExpressedField: {
      "@type": "VKernel:Class",
      "rdfs:subClassOf": "VState:Field",
      "rdfs:comment":
`The class of valospace fields which have a full triple expression in
all regular query and graph contexts (as opposed to fields with
non-triple semantics or triple expression only in limited contexts).`
    },
    expressor: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:ExpressedField",
      "rdfs:range": "rdfs:List",
      "rdfs:comment": [
`The custom 'getter' expressor of an ExpressedField as a VPlot.`,
`This expressor is used to resolve the dynamic, inferred value of the
field whenever it is requested. More specifically, whenever an inferred
state triple is requested for a resource field with a custom expressor
the expressor vplot is valked using following scope values:`,
        { "bulleted#": [
[ref("VValk:0"), "is set to the field owner resource id"],
[ref("VValk:1"), "is set to the field id"],
[ref("VValk:2"), `is a possible valospace primary field value if one is
    defined (in which case the expressor can act as a transformer)`],
        ] },
  `Once the valk is resolved the inferred triple subject, predicate and
  object are set to be the field owner resource id, the field id itself
  and the valk result value, respectively.`,
      ],
    },
    EventLoggedField: {
      "@type": "VKernel:Class",
      "rdfs:subClassOf": "VState:ExpressedField",
      "rdfs:comment":
`The class of valospace fields which have both a triple state
expression inside valospace and a change impression in event logs;
these are the primary, persisted sources of truth.`
    },
    impressor: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:EventLoggedField",
      "rdfs:range": "rdfs:List",
      "rdfs:comment": [
`The custom 'setter' impressor of an EventLoggedField as a VPlot.`,
`This impressor is used as part of building an event object whenever
some operation would assign a value to the field. More specifically,
upon assignment the impressor vplot is valked using following scope
values:`,
        { "bulleted#": [
[ref("VValk:0"), "is set to the field owner id"],
[ref("VValk:1"), "as the field id"],
[ref("VValk:2"), "is set to the new value being updated to this field."],
[ref("VState:3"), `is set to possible valospace primary value of the field
    if one is defined (in which case the expressor can act as a mutator)`],
        ] },
      ],
    },
    CoupledField: {
      "@type": "VKernel:Class",
      "rdfs:subClassOf": "VState:ExpressedField",
      "rdfs:comment":
`The class of valospace fields which have a triple expression inside
valospace via their coupled fields but lack an event log impression.`
    },
    GeneratedField: {
      "@type": "VKernel:Class",
      "rdfs:subClassOf": "VState:ExpressedField",
      "rdfs:comment": [
`The class of inferred fields where a field is not associated with
raw valospace triples but the triples are fully generated by the
expressor, with scope values:`,
        { "bulleted#": [
[ref("VValk:0"), "is set to the field owner id"],
[ref("VValk:1"), "is set to the field id"],
[ref("VValk:2"), "is set as undefined"],
        ] },
      ],
    },
    TransientField: {
      "@type": "VKernel:Class",
      "rdfs:subClassOf": "VState:Field",
      "rdfs:comment":
`The class of valospace fields with no general triple expression but
with custom semantics for specific queries.`,
    },
    AliasField: {
      "@type": "VKernel:Class",
      "rdfs:subClassOf": "VState:Field",
      "rdfs:comment":
`The class of inferred fields called alias fields where each such field
has an 'aliasOf' RDF property or valos Field. Alias fields are
mutation-inference symmetric so that triples with an alias field as
predicate are inferred from triples with aliasOf as predicate and
mutations with an alias field as predicate are translated to use
the aliasOf as predicate.`,
    },
    aliasOf: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:AliasField",
      "rdfs:range": "VState:Field",
      "rdfs:comment":
`The alias target property specifies the inference source and mutation
target of an alias field.`,
    },
    isOwnerOf: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "xsd:boolean",
      "rdfs:comment":
`This field refers to a resource which is owned by the field subject
resource. If the subject resource is is destroyed or if this field
is removed then the owned resource is cascade destroyed.`,
    },
    isOwnedBy: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "xsd:boolean",
      "rdfs:comment":
`This field refers to a resource which owns the field subject resource.
If the owner is destroyed or if the coupled field (which is marked
with isOwnerOf) is removed from the owner then the subject resource
will be cascade destroyed. Removing the isOwnedBy field itself will
only orphan the subject resource.`,
    },
    coupledToField: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "valosField",
      "rdfs:comment":
`This field infers a reverse triple with predicate equal to this field
value.`,
    },
    linkedToField: {
      "@type": "VKernel:Property",
      "rdfs:subPropertyOf": "VState:coupledToField",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "valosField",
      "rdfs:comment":
`This field requires the existence of a reverse triple with predicate
equal to this field value.`,
          },
    coupledField: {
      "@type": "VKernel:Property",
      "VRevdoc:deprecatedInFavorOf": "VState:coupledToField",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "valosField",
      "rdfs:comment":
  ``,
    },
    defaultCoupledField: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "xsd:string",
      "rdfs:comment":
  ``,
    },
    preventsDestroy: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "xsd:boolean",
      "rdfs:comment":
`Field with this property prevent destruction of their subject
resource if the field has active couplings inside the same chronicle.`,
    },
    isDuplicateable: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "xsd:boolean",
      "rdfs:comment":
`If set to false this field not be visible for DUPLICATED class of
events.`,
    },
    initialValue: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "rdfs:Resource",
      "rdfs:comment":
`The implicit initial value of the resource field when the resource is
created.`,
    },
    ownDefaultValue: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "rdfs:Resource",
      "rdfs:comment":
`The value of a resource field which doesn't have an own value defined
(ie. is evaluated before prototype field lookup).`,
    },
    finalDefaultValue: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "rdfs:Resource",
      "rdfs:comment":
`The value of a resource field which doesn't have a value defined by
any resource in its prototype chain.`,
    },
    allowTransientFieldToBeSingular: {
      "@type": "VKernel:Property",
      "rdfs:domain": "VState:Field",
      "rdfs:range": "xsd:boolean",
      "rdfs:comment":
`Bypass the default behavior which forces transient fields to be plural
to allow for singular fields.`,
    },
  },
};
