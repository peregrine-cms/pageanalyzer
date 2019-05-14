const { execSync } = require('child_process');

const fs = require('fs-extra');

const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const CDP = require('chrome-remote-interface');

async function launchChromeAndRunLighthouse(url, opts, config = null) {
  return chromeLauncher.launch({chromeFlags: opts.chromeFlags}).then(chrome => {
    opts.port = chrome.port;
    return lighthouse(url, opts, config).then(results => {
      return chrome.kill().then(() => results)
    });
  });
}


async function scanPageLighthouse(url, name) {
  const opts = {
    chromeFlags: ['--headless'],
    output: 'html'
  };

  const res = { };
  let raw; 
  console.log('start lh', url)
  await launchChromeAndRunLighthouse(url, opts).then(results => {
    for(key in results.lhr.categories) {
      res[key] = results.lhr.categories[key].score;
    }
    raw = results.lhr;
    fs.writeFileSync('out/lighthouse-'+name+'.html',results.report);
    fs.writeFileSync('out/lighthouse-'+name+'.json',JSON.stringify(results.lhr, true, 2));
    console.log('write lh', url)

  });
  res.id = 'lighthouse';
  console.log('done lh', url)
  return { summary: res, raw: raw };
}

async function scanPageAxe(url, name) {
  execSync('npx axe '+url+' -s out/axe-'+name+'.json --no-reporter');
  const res = fs.readJSONSync('out/axe-'+name+'.json');
  return { summary: { id: 'axe', violations: res[0].violations.length }, raw: res[0]};
}

async function scanPage(url, name) {
  fs.mkdirsSync('out');
  const res = { path: url, results: {} };
  res.results['axe'] = await scanPageAxe(url, name);
  res.results['lighthouse'] = await scanPageLighthouse(url, name);

  fs.writeFileSync('out/result-'+name+'.json', JSON.stringify(res, true, 2));
  return true;
}

function createHTMLReport(report) {
  const out = [];
  out.push('<table>');
  out.push(`<tr><td>url</td>
  <td style="min-width: 60px">violations</td>
  <td>performance</td>
  <td>accessibility</td>
  <td>best practices</td>
  <td style="min-width: 60px">seo</td>
  <td style="min-width: 60px">pwa</td>
      </tr>`)
    report.forEach( node => {
    out.push(`<tr><td><a href="${node.path}">${node.path}</a></td>
<td align="right">${node.results.axe.summary.violations}</td>
<td align="right">${node.results.lighthouse.summary.performance}</td>
<td align="right">${node.results.lighthouse.summary.accessibility}</td>
<td align="right">${node.results.lighthouse.summary['best-practices']}</td>
<td align="right">${node.results.lighthouse.summary.seo}</td>
<td align="right">${node.results.lighthouse.summary.pwa}</td>
    </tr>`)
  })
  out.push('</table>');
  fs.writeFileSync('out/report.html', out.join('\n'));
}

async function spiderPage(chrome, url) {
  console.log(chrome.port)
  const client = await CDP({ port: chrome.port });
  const {Network, Page, Runtime} = client;
  try {
      await Network.enable();
      await Page.enable();
      await Network.setCacheDisabled({cacheDisabled: true});
      const result = await Runtime.evaluate({ expression: '[].slice.call(window.document.querySelectorAll("a")).join(",")' });
      let idx = 0;
      result.result.value.split(',').forEach( url => {
        if(url.startsWith('http')) {
          console.log(idx++, url);
          const name = url.split('/').pop().replace('.html', '');
          execSync('node src/index.js '+name+' '+url);
        }
      });
      chrome.kill();
      const report = [];
      result.result.value.split(',').forEach( url => {
        if(url.startsWith('http')) {
          const name = url.split('/').pop().replace('.html', '');
          const data = fs.readJSONSync('out/result-'+name+'.json');
          report.push(data);
        }
      });
      fs.writeJSONSync('out/report.json', report);
      createHTMLReport(report);
  } catch (err) {
      console.error(err);
  } finally {
      client.close();
  }

}

async function scanMultiple(url) {
  return chromeLauncher.launch({chromeFlags: ['--headless'], startingUrl: url}).then(chrome => {
    spiderPage(chrome, url);
})
}

if(process.argv.length >= 4) {
  scanPage(process.argv[3], process.argv[2]);
} else if(process.argv.length >= 3) {
  scanMultiple(process.argv[2]);
} else {
  console.log('pageanalizer [name] [url]')
  console.log('pageanalizer [url]')
  createHTMLReport(fs.readJSONSync('out/report.json'));
}

