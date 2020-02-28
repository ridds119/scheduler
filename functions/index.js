const functions = require('firebase-functions')
const VoximplantApiClient = require('@voximplant/apiclient-nodejs').default
const axios = require('axios')
const qs = require('querystring')
require('dotenv').config()
exports.scheduler = functions.https.onRequest(async (request, response) => {
  const client = new VoximplantApiClient('./credentials.json')
  let html = ''
  let params = {
    fromDate: new Date(request.query.from_date.toString() + ' GMT'),
    toDate: new Date(request.query.to_date.toString() + ' GMT')
  }
  client.onReady = async function (e) {
    try {
      console.log('********** QUERY PARAMS **************')
      console.log(params.fromDate)
      console.log(params.toDate)
      let i = 0,
        data = { result: [], total_count: 0 }
      while (i < 5 && data.total_count == 0) {
        data = await fetchLogsList()
        console.log('-------- ' + i + ' -------')
        console.log(data)
        i++
      }
      if (data.total_count > 0 && data.result[0].logFileUrl) {
        console.log(data.result[0].logFileUrl)
        if (await fetchNewlyGeneratedLog(data.result[0].logFileUrl)) {
          let email = axios.post('https://us-central1-rhapsodyautomatedcallservice-a.cloudfunctions.net/emailer', qs.stringify({
            'session_id': data.result[0].call_session_history_id,
            'html': html
            }),
            {
              headers: {  'Content-Type': 'application/x-www-form-urlencoded' }
            }
          )
          response.status(200).send('Ok')
        } else {
          response.status(500).send('No log found')
        }
      } else {
        response.status(500).send('Logs fetch failed')
      }
    } catch (err) {
      console.log(err)
      response.status(500).send(JSON.stringify(err))
    }
  }
  function fetchLogsList () {
    return new Promise((resolve, reject) => {
      setTimeout(async function () {
        console.log('AWAITING ACCESSLOGS  ->')
        let data = await client.History.getCallHistory(params)
        return resolve(data)
      }, 30000)
    })
  }
  async function fetchNewlyGeneratedLog (url) {
    html = '<!DOCTYPE html><html><body>';
    let { status , data } = await axios.get(url + `&account_id=${process.env.ACCOUNT_ID}&api_key=${process.env.API_KEY}`);
    if(status !== 200) return false;
    let logs = data.split('\n')
    logs.forEach(line => parseLine(line))
    console.log('=============html=============:', html)
    return true
  }
  function parseLine (line) {
    if (line.match(/CallPSTN/)) {
      html += '<hr><h4><u>New Call Initiated</u></h4>'
      let words = line.split('{')[2].split(';')
      html += `<p> ${words[0]}</p><p> Dailed ${words[3]}</p><hr>`
    } else if (line.match(/Call.Connected/)) {
      let words = line.split(' ')
      html += `<p> Call connected on: ${words[0]} at ${words[1]}</p><hr>`
    } else if (line.match(/fulfillmentText/)) {
      let queryText = line.split('queryText":')[1].split(',"')[0]
      let fulfillmentText = line.split('fulfillmentText":')[1].split(',"')[0]
      html += '<p> User: ' + queryText + '</p>'
      html += '<p> Agent: ' + fulfillmentText + '</p>'
      // console.log("User: "+ queryText);
      // console.log("Agent: "+fulfillmentText);
    } else if (line.match(/Call.Disconnected/)) {
      let words = line.split(' ')
      html +=
        '<hr><p> Call disconnected on: ' +
        words[0] +
        ' at ' +
        words[1] +
        '</p><hr></body></html>'
    } else if (line.match(/Call.Failed/) && line.match(/reason =/)) {
      let reason = line.split('reason =')[1].split(';')[0]
      console.log(reason)
      html += '<p> Call failed '
      if (reason) {
        html += '=>reason: ' + reason
      }
      html += '</p><hr></body></html>'
    }
  }
})
