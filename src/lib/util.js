/*
  This library contains several common used utility functions used by the
  P2P VPS server APIs. This file essentially contains the low-level business
  logic expressed by the /client API.

  Functions included in this library:

  getDevicePublicModel() - retreive the devicePublicModel from the DB.
  getDevicePrivateModel() - retrieve the devicePrivateModel from the DB.
  getLoginPassAndPort() - retrieve the Login, Pass, and Port for a new device.
  getObContract() - get an existing obContract model.
  createObContract() - create an obContract model in the DB.
  createObStoreListing() - create a new listing in the OB store.
  submitToMarket() - generate a new obContract model and store listing.
  removeOBListing() - remove a listing from the OB store.
  createNewMarketListing() - Create a new listing for a device rental.
  processPayments() - handle pro-rating of payments upon register() call.
*/

'use strict'

// Dependencies
// const keystone = require('keystone')
const rp = require('request-promise')
// const openbazaar = require('openbazaar-node');
const obContractApi = require('../modules/obcontract/index.js')
const openbazaar = require(`./openbazaar.js`)
const serverUtil = require('../../bin/util')
const DevicePublicModel = require('../models/devicepublicdata.js')
const DevicePrivateModel = require('../models/deviceprivatedata.js')
const ObContractModel = require('../models/obcontract.js')

const LOCALHOST = 'http://localhost:5000'

module.exports = {
  getDevicePublicModel,
  getDevicePrivateModel,
  getLoginPassAndPort,
  getObContractModel,
  createObContract,
  createObStoreListing,
  submitToMarket,
  removeOBListing,
  createNewMarketListing,
  createRenewalListing,
  loginAdmin,
  processPayments // Handle pro-rating of payments upon register() call.
}

// Return a promise that resolves to the devicePublicModel.
function getDevicePublicModel (deviceId) {
  return new Promise(function (resolve, reject) {
    DevicePublicModel.model.findById(deviceId).exec(function (err, devicePublicModel) {
      if (err) return reject(err)
      if (!devicePublicModel) return reject('Device not found')

      return resolve(devicePublicModel)
    })
  })
}

// Return a promise that resolves to the devicePrivateModel.
function getDevicePrivateModel (deviceId) {
  return new Promise(function (resolve, reject) {
    DevicePrivateModel.model.findById(deviceId).exec(function (err, devicePrivateModel) {
      if (err) return reject(err)
      if (!devicePrivateModel) return reject('Device private model not found')

      return resolve(devicePrivateModel)
    })
  })
}

// Return a promise that resolves to an object containing a new login, password,
// and SSH port, generated by Port Control.
function getLoginPassAndPort () {
  const options = {
    method: 'GET',
    uri: 'http://localhost:3000/api/portcontrol/create',
    json: true // Automatically stringifies the body to JSON
  }

  return rp(options)
}

// Return a promise that resolves to the devicePublicModel.
function getObContractModel (deviceId) {
  return new Promise(function (resolve, reject) {
    ObContractModel.model.findById(deviceId).exec(function (err, thisModel) {
      if (err) return reject(err)
      if (!thisModel) return reject('Device not found')

      return resolve(thisModel)
    })
  })
}

// Create a new obContract model based on the passed in object.
function createObContract (obj) {
  let options = {
    method: 'POST',
    // uri: 'http://localhost:3000/api/obContract/create',
    uri: `${LOCALHOST}/obcontract`,
    body: obj,
    json: true // Automatically stringifies the body to JSON
    // resolveWithFullResponse: true
  }

  // Create the obContract model.
  return rp(options)
}

// Create a new OB store listing by calling the createMarketListing API.
function createObStoreListing (obContractModel) {
  let options = {
    method: 'GET',
    uri: `http://localhost:3000/api/ob/createMarketListing/${obContractModel.collection._id}`,
    json: true // Automatically stringifies the body to JSON
  }

  return rp(options)
}

// This function removes the associated listing from the OB store,
// and it also removed the obContract model from the database.
async function removeOBListing (deviceData) {
  // console.debug('Entering devicePublicData.js/removeOBListing().')
  try {
    const obContractId = deviceData.obContract

    // Validation/Error Handling
    if (obContractId === undefined || obContractId === null) {
      // throw `no obContract model associated with device ${deviceData._id}`
      return
    }
    // console.log(`obContractId: ${obContractId}`)

    // Get the obContract model.
    const obContract = await obContractApi.getContract(obContractId)
    // console.log(`obContract: ${JSON.stringify(obContract, null, 2)}`)

    // Remove the OB store listing
    await openbazaar.removeMarketListing(obContract.listingSlug)

    // Log in as the system admin.
    const admin = await serverUtil.loginAdmin()
    const token = admin.body.token

    // Remove the obContract model from the DB.
    const config = {}
    config.token = token
    config.obContractId = obContract._id
    await obContractApi.removeContract(config)
  } catch (err) {
    if (err.statusCode === 404) return

    console.error(`Error in src/lib/util.js in removeOBListing().`)
    throw err
  }
}

function createNewMarketListing (device) {
  // Generate an expiration date for the store listing.
  let now = new Date()
  const oneMonth = 1000 * 60 * 60 * 24 * 30
  let temp = now.getTime() + oneMonth
  let oneMonthFromNow = new Date(temp)

  // logr.debug(`oneMonth: ${oneMonth}`);
  // logr.debug(`now.getTime()+oneMonth = ${temp}, now.getTime() = ${now.getTime()}`);
  // logr.debug(`Setting experation to: ${oneMonthFromNow.toISOString()}, time now is ${new Date()}`);

  // Create new obContract model
  var obj = {
    clientDevice: device._id.toString(),
    ownerUser: device.ownerUser.toString(),
    renterUser: '',
    price: 3,
    experation: oneMonthFromNow.toISOString(),
    title: device.deviceName,
    description: device.deviceDesc,
    listingUri: '',
    imageHash: '',
    listingState: 'Listed',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }

  return submitToMarket(device, obj)
  // return true
}

function createRenewalListing (device) {
  // Generate an expiration date for the store listing.
  let now = new Date()
  const oneHour = 1000 * 60 * 60
  let temp = now.getTime() + oneHour
  let oneHourFromNow = new Date(temp)

  const newDesc = `This is a renewal listing for ${device.deviceName}.
  Purchasing this listing will renew the contract for the existing renter. ` +
  device.deviceDesc

  // Create new obContract model
  var obj = {
    clientDevice: device._id.toString(),
    ownerUser: device.ownerUser.toString(),
    renterUser: '',
    price: 3,
    experation: oneHourFromNow.toISOString(),
    title: `Renewal - ${device.deviceName}`,
    description: newDesc,
    listingUri: '',
    imageHash: '',
    listingState: 'Listed',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }

  return submitToMarket(device, obj)
  // return true
}

// Generate an obContract model and use it to create a new listing on the OB
// store.
// device = devicePublicData Model
// obContractData = object used to create an obContract model.
// Returns a promise that resolves to the ID of the newly created obContract model.
async function submitToMarket (device, obContractData) {
  try {
    // Check if device already has an obContract GUID associated with it.
    const obContractId = device.obContract
    if (obContractId !== '' && obContractId !== null) {
      // console.log(`submitToMarket() obContractId: ${obContractId}`)

      // Remove the old store listing and obContract Model.
      await removeOBListing(device)
      console.log(`OB Listing for ${device._id} successfully removed.`)
    }

    // Log in as the system admin.
    const admin = await serverUtil.loginAdmin()
    const token = admin.body.token
    // console.log(`admin.body: ${JSON.stringify(admin.body, null, 2)}`)

    // Create an obContract model.
    console.log(`Creating new obContract.`)
    let obContractModel = await obContractApi.createContract(token, obContractData)

    // Create a new store listing.
    console.log(`Creating OpenBazaar store listing.`)
    obContractModel = await openbazaar.createStoreListing(obContractModel)

    // Update the contract model.
    console.log(`Updating obContract.`)
    await obContractApi.updateContract(token, obContractModel)

    // Return the GUID of the newly created obContract model.
    return obContractModel._id

  // Catch any errors.
  } catch (err) {
    console.error('Error trying to create OB listing in util.js/submitToMarket():')
    throw err
  }
}

async function loginAdmin () {
  try {
    // Ensure the environment variable is set
    process.env.NODE_ENV = process.env.NODE_ENV || 'dev'
    const env = process.env.NODE_ENV
    const JSON_FILE = `system-user-${env}.json`

    const ADMIN_INFO = `${__dirname}/../../config/${JSON_FILE}`
    const admin = require(ADMIN_INFO)
    console.log(`admin: ${JSON.stringify(admin, null, 2)}`)

    // Log in as the user.
    let options = {
      method: 'POST',
      uri: `${LOCALHOST}/auth`,
      resolveWithFullResponse: true,
      json: true,
      body: {
        username: admin.username,
        password: admin.password
      }
    }
    let result = await rp(options)

    admin.token = result.body.token

    return admin
  } catch (err) {
    console.log('Error retrieving system admin auth info in src/lib/util.js/loginAdmin()')
    throw err
  }
}

// Handle pro-rating of payments upon register() call.
// TODO right now this function is hard coded for 24 hr rentals. Need to update
// to handle different rental periods.
async function processPayments (pmtObj) {
  try {
    const pmtAry = pmtObj.devicePrivateModel.payments

    // Exit if their isn't at least one element in the array.
    if (!pmtAry || pmtAry.length < 1) return

    const now = new Date()
    // const oneDay = 1000 * 60 * 60 * 24
    const aryLength = pmtAry.length
    const lastPmt = pmtAry[aryLength - 1]

    // Note: This is the time when the contract will *expire* and payment should be
    // made to the device owner. This is set 24 hours in the future of when the
    // trade occured.
    const lastPmtDate = new Date(lastPmt.payTime)

    // If the last payment date happened less than 24 hours ago, then pro-rate.
    if (lastPmtDate.getTime() > now.getTime()) {
      await prorate(pmtObj)
    }
  } catch (err) {
    console.error(`Error in lib/util.js/processPayments(): `, err)
    throw err
  }
}

// Pro-rate a Payment object.
// TODO right now this function is hard coded for 24 hr rentals. Need to update
// to handle different rental periods.
async function prorate (pmtObj) {
  try {
    const now = new Date()
    const oneDay = 1000 * 60 * 60 * 24

    // Convert the payment payTime into a Date object.
    // Note: This is the time when the contract will *expire* and payment should be
    // made to the device owner. This is set 24 hours in the future of when the
    // trade occured.
    const pmtAryLen = pmtObj.devicePrivateModel.payments.length
    const pmt = pmtObj.devicePrivateModel.payments[pmtAryLen - 1]
    const pmtDate = new Date(pmt.payTime)

    console.log(`now: ${now.toLocaleString()}`)
    console.log(`pmtDate: ${pmtDate.toLocaleString()}`)

    // Calculate the percentage consumed.
    const refundTime = pmtDate.getTime() - now.getTime()
    console.log(`refundTime: ${refundTime}`)
    const refundPercentage = refundTime / oneDay
    console.log(`refundPercentage: ${refundPercentage}`)

    // Calculate prorated amount to send to seller and amount to return to the seller.
    const refundSatoshis = Math.floor(pmt.payQty * refundPercentage)
    const payAmount = pmt.payQty - refundSatoshis

    console.log(`pmt: ${JSON.stringify(pmt, null, 2)}`)
    console.log(`refundSatoshis: ${refundSatoshis}`)
    console.log(`payAmount: ${payAmount}`)

    // Send payAmount to devicePublicModel.ownerUser.
    if (!pmtObj.devicePrivateModel.moneyOwed) pmtObj.devicePrivateModel.moneyOwed = 0
    pmtObj.devicePrivateModel.moneyOwed += payAmount

    // Remove the payment object from the devicePrivateModel
    pmtObj.devicePrivateModel.payments.pop()

    // Save the deviePrivateModel.
    await pmtObj.devicePrivateModel.save()

    // Send returnAmount to pmt.refundAddr
    const refundObj = {
      addr: pmt.refundAddr,
      qty: refundSatoshis
    }
    await openbazaar.refund(refundObj)
  } catch (err) {
    console.error(`Error in util.js/prorate(): `, err)
    throw err
  }
}
