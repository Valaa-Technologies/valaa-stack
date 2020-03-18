const extendOntology = require("./extendOntology");

const htmlSpecBase = "https://html.spec.whatwg.org/multipage/";
const prefixes = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  owl: "http://www.w3.org/2002/07/owl#",
  dc: "http://purl.org/dc/elements/1.1/",
};

module.exports = extendOntology("vdoc", "https://valospace.org/vdoc#", prefixes, {
  Class: { "@type": ["vdoc:Class", "valos_kernel:Class"],
    "rdfs:subClassOf": "rdfs:Class",
    "rdfs:comment": "The class of classes which are defined by vdoc or a vdoc extension",
  },
  Property: { "@type": ["vdoc:Class", "valos_kernel:Class"],
    "rdfs:subClassOf": "rdf:Property",
    "rdfs:comment": "The class of properties which are defined by vdoc or a vdoc extension",
  },
  Node: { "@type": "vdoc:Class",
    "rdfs:comment": "A document tree Node",
  },
  resourceId: { "@type": "vdoc:Property",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "xsd:string",
    "rdfs:comment": "The resource identifier of a resource node",
  },
  content: { "@type": "vdoc:Property",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:List",
    "rdfs:comment": "The primary visible content of a Node",
  },
  words: { "@type": "vdoc:Property",
    "rdfs:subPropertyOf": "vdoc:content",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:List",
    "rdfs:comment": "A visible list of visually separate words",
  },
  entries: { "@type": "vdoc:Property",
    "rdfs:subPropertyOf": "vdoc:content",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:List",
    "rdfs:comment": "A visible list of vertically or horizontally segmented entries",
  },
  lookup: { "@type": "vdoc:Property",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:Resource",
    "rdfs:comment": "A reference to a lookup structure for string literal entries",
  },
  wide: { "@type": "vdoc:Property",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:Resource",
    "rdfs:comment": "Marks the node content as being wide",
  },
  tall: { "@type": "vdoc:Property",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:Resource",
    "rdfs:comment": "Marks the node content as being tall",
  },
  Chapter: { "@type": "vdoc:Class",
    "rdfs:subClassOf": "vdoc:Node",
    "rdfs:comment": "A titled, possibly numbered chapter document node",
  },
  Paragraph: { "@type": "vdoc:Class",
    "rdfs:subClassOf": "vdoc:Node",
    "rdfs:comment": "A vertically segmented paragraph document node",
  },
  BulletList: { "@type": "vdoc:Class",
    "rdfs:subClassOf": "vdoc:Node",
    "rdfs:comment": "A bullet list document node",
  },
  NumberedList: { "@type": "vdoc:Class",
    "rdfs:subClassOf": "vdoc:Node",
    "rdfs:comment": "A numbered list document node",
  },
  Table: { "@type": "vdoc:Class",
    "rdfs:subClassOf": "vdoc:Node",
    "rdfs:comment": "A two-dimensional table document node",
  },
  Header: { "@type": "vdoc:Class",
    "rdfs:subClassOf": "vdoc:Node",
    "rdfs:comment": "A table cross-entry-section header node",
  },
  headers: { "@type": "vdoc:Property",
    "rdfs:domain": "vdoc:Table",
    "rdfs:range": "rdfs:List",
    "rdfs:comment": "A list of table cross-entry-section headers",
  },
  cell: { "@type": "vdoc:Property",
    "rdfs:domain": "vdoc:Header",
    "rdfs:range": "rdfs:List",
    "rdfs:comment": "The template for building cell content using content selectors",
  },
  ContentSelector: { "@type": "vdoc:Class",
    "rdfs:comment": "The class of selectors with explicit meaning for selecting content",
  },
  selectKey: { "@type": "vdoc:ContentSelector",
    "rdfs:comment": "A content selector literal denoting the entry lookup key",
  },
  selectValue: { "@type": "vdoc:ContentSelector",
    "rdfs:comment": "A content selector literal denoting the whole entry value",
  },
  selectField: { "@type": "vdoc:Property",
    "rdfs:domain": "rdfs:Resource",
    "rdfs:range": "rdfs:Literal",
    "rdfs:comment": "A content selector for the entry field denoted by the object of this triple",
  },
  CharacterData: { "@type": "vdoc:Class",
    "rdfs:subClassOf": "vdoc:Node",
    "rdfs:comment": "A character data document node",
  },
  language: { "@type": "vdoc:Property",
    "rdfs:domain": "vdoc:CharacterData",
    "rdfs:range": "rdfs:Resource",
    "rdfs:comment": "The language of the character data content",
  },
  Reference: { "@type": "vdoc:Class",
    "rdfs:subClassOf": "vdoc:Node",
    "rdfs:comment": "A reference document node",
  },
  ContextPath: { "@type": "vdoc:Class",
    "rdfs:subClassOf": "vdoc:Node",
    "rdfs:comment": "A context-based path document node",
  },
  context: { "@type": "vdoc:Property",
    "rdfs:domain": "vdoc:ContextPath",
    "rdfs:range": "rdfs:Resource",
    "rdfs:comment": "Non-visible context base (absolute or relative to current base)",
  },
  ContextBase: { "@type": "vdoc:Class",
    "rdfs:subClassOf": "vdoc:ContextPath",
    "rdfs:comment": "A context base setting document node",
  },
  HTMLElementProperty: { "@type": "vdoc:Class",
    "rdfs:subClassOf": "vdoc:Property",
    "rdfs:comment":
`The class of vdoc properties which directly inherit the semantics of a specific HTML5 element`,
  },
  elementName: { "@type": "vdoc:Property",
    "rdfs:domain": "vdoc:HTMLElementProperty",
    "rdfs:range": "xsd:string",
    "rdfs:comment": "The name of the html element associated with this property",
  },
  em: { "@type": "vdoc:HTMLElementProperty",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:Resource",
    "vdoc:elementName": "em",
    "vdoc:elementSpec": `${htmlSpecBase}text-level-semantics.html#the-em-element`,
    "rdfs:comment": "Node content is <em>emphasised</em>",
  },
  strong: { "@type": "vdoc:HTMLElementProperty",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:Resource",
    "vdoc:elementName": "strong",
    "vdoc:elementSpec": `${htmlSpecBase}text-level-semantics.html#the-strong-element`,
    "rdfs:comment": "Node content is <strong>strong</strong>",
  },
  ins: { "@type": "vdoc:HTMLElementProperty",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:Resource",
    "vdoc:elementName": "ins",
    "vdoc:elementSpec": `${htmlSpecBase}edits.html#the-ins-element`,
    "rdfs:comment": "Node content is an <ins>insertion</ins>",
  },
  del: { "@type": "vdoc:HTMLElementProperty",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:Resource",
    "vdoc:elementName": "del",
    "vdoc:elementSpec": `${htmlSpecBase}edits.html#the-del-element`,
    "rdfs:comment": "Node content is <del>deleted</del>",
  },
  quote: { "@type": "vdoc:HTMLElementProperty",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:Resource",
    "vdoc:elementName": "quote",
    "vdoc:elementSpec": `${htmlSpecBase}text-level-semantics.html#the-q-element`,
    "rdfs:comment": "Node content is <q>quoted</q>",
  },
  blockquote: { "@type": "vdoc:HTMLElementProperty",
    "rdfs:domain": "vdoc:Node",
    "rdfs:range": "rdfs:Resource",
    "vdoc:elementName": "blockquote",
    "vdoc:elementSpec": `${htmlSpecBase}grouping-content.html#the-blockquote-element`,
    "rdfs:comment": "Node content is <blockquote>block quoted</blockquote>",
  },
}, {
  extractionRules: {
    "": {
      comment: "Basic Node", owner: "vdoc:content", body: "vdoc:content",
      paragraphize: true,
    },
    chapter: {
      range: "vdoc:Chapter", owner: "vdoc:content", body: "vdoc:content", rest: "dc:title",
      comment: "Numbered, titled chapter",
    },
    p: {
      range: "vdoc:Paragraph", owner: "vdoc:content", body: "vdoc:content",
      comment: "Vertically segmented paragraph",
    },
    c: {
      range: "vdoc:CharacterData", owner: "vdoc:content", body: "vdoc:content",
      rest: "vdoc:language", comment: "Character data",
    },
    bulleted: {
      range: "vdoc:BulletList", owner: "vdoc:content", body: "vdoc:entries",
      comment: "Bulleted list",
    },
    numbered: {
      range: "vdoc:NumberedList", owner: "vdoc:content", body: "vdoc:entries",
      comment: "Numbered list",
    },
    table: {
      range: "vdoc:Table", owner: "vdoc:content", body: "vdoc:headers", rest: "vdoc:lookup",
      comment: "Table",
    },
    header: {
      range: "vdoc:Header", owner: "vdoc:entries", body: "vdoc:content", rest: "vdoc:cell",
      comment: "Header",
    },
    data: {
      range: null, owner: null, body: null,
      comment: "Hidden data",
    },
  },
});
