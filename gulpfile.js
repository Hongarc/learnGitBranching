var { execSync } = require('child_process');
var { writeFileSync, readdirSync, readFileSync } = require('fs');

var glob = require('glob');
var _ = require('underscore');

var { src, dest, series } = require('gulp');
var log = require('fancy-log');
var hash = require('gulp-hash-filename');
var clean = require('gulp-clean');
var terser = require('gulp-terser');
var jasmine = require('gulp-jasmine');

var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');
var browserify = require('browserify');
var reactify = require('reactify');

_.templateSettings.interpolate = /\{\{(.+?)\}\}/g;
_.templateSettings.escape = /\{\{\{(.*?)\}\}\}/g;
_.templateSettings.evaluate = /\{\{-(.*?)\}\}/g;

var prodDependencies = [
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/es5-shim/4.1.1/es5-shim.min.js"></script>',
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/1.8.0/jquery.min.js"></script>',
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/raphael/2.1.0/raphael-min.js"></script>'
];

var devDependencies = [
  '<script src="lib/jquery-1.8.0.min.js"></script>',
  '<script src="lib/raphael-min.js"></script>',
  '<script src="lib/es5-shim.min.js"></script>'
];

// precompile for speed
var indexFile = readFileSync('src/template.index.html').toString();
var indexTemplate = _.template(indexFile);

var compliments = [
  'Wow peter great work!',
  'Such a professional dev environment',
  'Can\'t stop the TRAIN',
  'git raging'
];
var compliment = (done) => {
  var index = Math.floor(Math.random() * compliments.length);

  log(compliments[index]);
  done();
};

const lintStrings = (done) => {
  execSync('node src/js/intl/checkStrings');
  done();
};


var destDir = './build/';

var buildIndex = function(config) {
  log('Building index...');

  // first find the one in here that we want
  var buildFiles = readdirSync(destDir);

  var jsRegex = /bundle-[\.\w]+\.js/;
  var jsFile = buildFiles.find(function(name) {
    return jsRegex.exec(name);
  });
  if (!jsFile) {
    throw new Error('no hashed min file found!');
  }
  log('Found hashed js file: ' + jsFile);

  var styleRegex = /main-[\.\w]+\.css/;
  var styleFile = buildFiles.find(function(name) {
    return styleRegex.exec(name);
  });
  if (!styleFile) {
    throw new Error('no hashed css file found!');
  }
  log('Found hashed style file: ' + styleFile);

  // output these filenames to our index template
  var outputIndex = indexTemplate({
    jsFile,
    styleFile,
    jsDependencies: config.isProd ?
      prodDependencies.join('\n') :
      devDependencies.join('\n')
  });
  writeFileSync('index.html', outputIndex);
};

var buildIndexProd = function(done) {
  buildIndex({ isProd: true });
  done();
};
var buildIndexDev = function(done) {
  buildIndex({ isProd: false });
  done();
};

var getBundle = function() {
  return browserify({
    entries: [...glob.sync('src/**/*.js'), ...glob.sync('src/**/*.jsx')],
    debug: true,
    transform: [reactify]
  })
  .bundle()
  .pipe(source('bundle.js'))
  .pipe(buffer())
  .pipe(hash());
};

var taskClean = function () {
  return src(destDir, { read: false, allowEmpty: true })
    .pipe(clean());
};

var tmpBuild = function() {
  return getBundle()
    .pipe(dest(destDir));
};

var miniBuild = function() {
  return getBundle()
    .pipe(terser())
    .pipe(dest(destDir));
};

var style = function() {
  return src('src/style/main.css')
    .pipe(hash())
    .pipe(dest(destDir));
}

var test = function() {
  return src('__tests__/git.spec.js')
    .pipe(jasmine());
}

var fastBuild = series(taskClean, tmpBuild, style, buildIndexDev);

var build = series(taskClean, miniBuild, style, buildIndexProd);

module.exports = {
  // lint,
  fastBuild,
  // watching,
  build,
  test,
  // casperTest,
};
