#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const Promise = require('bluebird')
const drafter = require('drafter')
const eidolon = require('eidolon')
const mustache = require('mustache')

function readFile(filename) {
  return new Promise((resolve, reject) => {
    fs.readFile(filename, 'utf8', (err, data) => {
      if (err) return reject(err)
      return resolve(data)
    })
  })
}

function writeFile(filename) {
  return (data) => {
    return new Promise((resolve, reject) => {
      fs.writeFile(filename, data, 'utf8', (err) => {
        if (err) return reject(err)
        return resolve(filename)
      })
    })
  }
}

function parseBlueprint(content) {
  return new Promise((resolve, reject) => {
    drafter.parse(content, {}, (err, result) => {
      if (err) return reject(err)
      return resolve(result)
    })
  })
}

function collectDataStructures(node) {
  let dataStructures = []
  if (node.element === 'dataStructure') {
    if (Array.isArray(node.content)) {
      dataStructures = dataStructures.concat(node.content)
    } else {
      dataStructures.push(node.content)
    }
  } else if (Array.isArray(node.content)) {
    node.content.forEach(child => {
      dataStructures = dataStructures.concat(collectDataStructures(child))
    })
  }
  return dataStructures
}

function dereferenceDataStructures(dataStructures) {
  const inputs = dataStructures
    .filter(ds => !ds.content)

  const registry = dataStructures
    .filter(ds => ds.content)
    .reduce((acc, ds) => {
      acc[ds.meta.id] = ds
      return acc
    }, {})

  return inputs.map(input => eidolon.dereference(input, registry))
}

function isRequired(schema) {
  return schema.attributes
      && schema.attributes.typeAttributes
      && schema.attributes.typeAttributes.indexOf('required') != -1
}

function getExample(schema) {
  return schema.attributes
      && schema.attributes.samples
      && schema.attributes.samples[0]
      && schema.attributes.samples[0].content
}

function getUniqueNames(properties) {
  return properties.map(p => p.name).filter((value, index, arr) => {
    return arr.indexOf(value) === index;
  })
}

function getUniqueTypes(properties) {
  return properties.map(p => p.type).filter((value, index, arr) => {
    return arr.indexOf(value) === index;
  })
}

function getTypeDisplay(type, properties) {
  if (type === 'enum') {
    return type
  }

  if (!properties || properties.length === 0) {
    return type
  }

  if (type === 'object') {
    const propNames = getUniqueNames(properties)
    return `{${propNames.join(', ')}}`
  }

  let propType = null;
  if (properties.length === 1) {
    const property = properties[0]
    propType = property.name || property.type
  } else {
    const propTypes = getUniqueTypes(properties)
    if (propTypes.length === 1) {
      propType = propTypes[0]
    }
  }

  return `${propType ? '[' + propType + ']' : ''}`
}

function mapSchemaSimple(schema) {
  return {
    name: undefined,
    type: schema.element, // always number, string
    typeDisplay: getTypeDisplay(schema.element),
    description: undefined, // TODO: check if possible
    required: undefined,  // TODO: check if possible
    example: schema.content,
    properties: undefined,
  }
}

function mapSchemaCollection(schema) {
  const properties = schema.content.map(mapSchema)
  return {
    name: undefined,
    type: schema.element, // always enum, array
    typeDisplay: getTypeDisplay(schema.element, properties),
    description: undefined,
    required: undefined,
    example: getExample(schema) || properties[0].example,
    properties,
  }
}

function mapSchemaMember(schema) {
  const member = mapSchema(schema.content.value)
  return {
    name: schema.content.key.content,
    type: member.type,
    typeDisplay: getTypeDisplay(member.type, member.properties),
    description: schema.meta && schema.meta.description,
    required: isRequired(schema),
    example: member.example,
    properties: member.properties,
  }
}

function mapSchemaObject(schema) {
  const properties = schema.content.map(mapSchema)
  return {
    name: schema.meta && schema.meta.ref, // can be unnamed
    type: schema.element, // always object
    typeDisplay: getTypeDisplay(schema.element, properties),
    description: schema.meta && schema.meta.description,
    required: isRequired(schema),
    example: undefined, // are the properties
    properties,
  }
}

function mapSchema(schema) {
  const type = schema.element
  switch (type) {
    case 'object':
      return mapSchemaObject(schema)
    case 'member':
      return mapSchemaMember(schema)
    case 'array':
    case 'enum':
      return mapSchemaCollection(schema)
    case 'number':
    case 'string':
      return mapSchemaSimple(schema)
    default:
      // return { type: `TODO: ${type}` }
      throw new Error('unknown element: ' + type)
  }
}

function mapSchemas(schemas) {
  return schemas.map(mapSchema)
}

function renderTemplate(filename) {
  return (schemas) => {
    const data = {
      schemas: JSON.stringify(schemas, null, 2)
    }
    return readFile(filename).then(template => {
      return mustache.render(template, data);
    })
  }
}

function printJSON(json) {
  console.log(JSON.stringify(json, null, 2))
  return json
}

const args = process.argv.slice(2)
if (args.length != 2) {
  console.error(`usage: blueprint-schema-viewer <input.apib> <output.html>`)
  process.exit(2)
}
const inputFile = args[0]
const outputFile = args[1]
const templateFile = path.join(__dirname, 'template.html.mustache')

Promise.resolve(inputFile)
  .then(readFile)
  .then(parseBlueprint)
  .then(collectDataStructures)
  .then(dereferenceDataStructures)
  .then(mapSchemas)
  // .then(printJSON)
  .then(renderTemplate(templateFile))
  .then(writeFile(outputFile))
  .then(console.log)
  .catch(console.error)
