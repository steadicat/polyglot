#!/usr/bin/env node

var acornBabel = require('acorn-babel');
var path = require('path');
var fs = require('fs');
var merge = require('merge');
var Set = require('Set');
var mkdirp = require('mkdirp');
var commander = require('commander');
var glob = require('glob');

function list(val) {
  return val.split(',');
}

commander
  .version('0.0.1')
  .usage('[options] <sources>')
  .option('-l, --languages <languages>', 'Comma-separated list of two-letter language codes to generate language files for', list, ['en','it'])
  .option('-f, --function <function>', 'The name of the translation function to look for', 't')
  .option('-o, --output <output>', 'The path to the directory containing translation files', './languages/')
  .option('-i, --ignore <ignore>', 'A glob matching files to ignore')
  .parse(process.argv);

function concat(a, b) {
  return a.concat(b);
}

function isTranslationFunctionCall(functionName, code) {
  var bits = functionName.split('.');
  if (bits.length === 2) {
    return isMemberExpressionCall(bits[0], bits[1], code);
  } else if (bits.length === 1) {
    return isIdentifierCall(functionName, code);
  } else {
    console.log('Invalid function name:', functionName);
  }
}

function isIdentifierCall(functionName, code) {
  code = code.code;
  return code.type &&
         code.type === 'CallExpression' &&
         code.callee.type === 'Identifier' &&
         code.callee.name === functionName;
}

function isMemberExpressionCall(objectName, methodName, code) {
  code = code.code;
  return code &&
    code.type === 'CallExpression' &&
    code.callee.type === 'MemberExpression' &&
    code.callee.object.name === objectName &&
    code.callee.property.name === methodName;
}

function textUnpacker(code) {
  if (code.type &&
      code.type === 'CallExpression' &&
      code.callee.type === 'MemberExpression' &&
      code.callee.object.name === 'React' &&
      code.callee.property.name === 'createElement') {
    return code.arguments.slice(2);
  } else {
    return defaultUnpacker(code);
  }
}

function extractText(code) {
  code = code.code;
  return traverse(textUnpacker, 0, code.arguments).filter(function(code) {
    code = code.code;
    return code && code.type && code.type === 'Literal';
  }).reduce(function(acc, code) {
    var marker = acc.text ? (acc.depth > code.depth ? ']' : '[') : '';
    return {
      text: acc.text + marker + (code.code.value || ''),
      depth: code.depth
    };
  }, {text: '', depth: 0}).text;
}

function defaultUnpacker(code) {
  if (Array.isArray(code)) {
    return code;
  } else if (typeof code === 'object') {
    return Object.keys(code).map(function(key) {
      return code[key];
    });
  } else {
    return [];
  }
}

function traverse(unpacker, depth, code) {
  if (!code) return [];
  return unpacker(code)
    .map(traverse.bind(null, unpacker, depth+1))
    .reduce(concat, [{code: code, depth: depth}]);
}

function extractStrings(code, functionName) {
  return traverse(defaultUnpacker, 0, code)
    .filter(isTranslationFunctionCall.bind(null, functionName))
    .map(extractText);
}

function toXliff(strings) {
  return [
      "<xliff xmlns='urn:oasis:names:tc:xliff:document:2.0' version='2.0' srcLang='en'>",
      "<file id='1'>",
      "<unit id='1'>",
    ].concat(strings.toArray().map(function(string) {
      return [
        "<segment>",
        "<source>"+string+"</source>",
        "</segment>"
      ].join('\n');
    })).concat([
      "</unit>",
      "</file>",
      "</xliff>"
    ]).join('\n');
}

function main(pattern, languages, functionName, output, ignore) {
  var strings = new Set();
  mkdirp(output, function(err) {
    if (err) console.log(err);
  });
  glob(pattern, {ignore: ignore}, function(err, input) {
    if (err) return console.log(err);

    input.forEach(function(fileName) {
      var file = fs.readFileSync(fileName);
      var parsed = acornBabel.parse(file, {ecmaVersion: 7});
      extractStrings(parsed, functionName).forEach(function(s) {
        strings.add(s);
      });
    });
    languages.forEach(function(language) {
      var enStrings = strings.toArray().reduce(function(obj, s) {
        obj[s] = "";
        return obj;
      }, {});
      var fileName = path.join(output, language + '.json');
      fs.readFile(fileName, function(err, data) {
        if (err) {
          data = '{}';
        }
        data = JSON.parse(data);
        for (var k in data) {
          if (data[k] === '') delete data[k];
        }
        var langStrings = merge(enStrings, data);
        fs.writeFile(fileName, JSON.stringify(langStrings, null, 2), function(err) {
          if (err) console.log(err);
        });
      });
    });

  });

}

main(commander.args[0], commander.languages, commander['function'], commander.output, commander.ignore);
