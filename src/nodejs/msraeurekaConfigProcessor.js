/*
  Copyright (c) 2017, F5 Networks, Inc.
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
  *
  http://www.apache.org/licenses/LICENSE-2.0
  *
  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
  either express or implied. See the License for the specific
  language governing permissions and limitations under the License.
  
  Updated by Ping Xiong on May/15/2022.
  Updated by Ping Xiong on Jul/3/2022, using global var for polling signal.
*/

'use strict';

// Middleware. May not be installed.
var configTaskUtil = require("./configTaskUtil");
var blockUtil = require("./blockUtils");
var logger = require('f5-logger').getInstance();
var mytmsh = require('./TmshUtil');
const fetch = require('node-fetch');
const Bluebird = require('bluebird');
fetch.Promise = Bluebird;

//var EventEmitter = require('events').EventEmitter;
//var stopPollingEvent = new EventEmitter(); 


// Setup a polling signal for audit.
//var fs = require('fs');
//const msraeurekaOnPollingSignal = '/var/tmp/msraeurekaOnPolling';
global.msraeurekaOnPolling = [];


//const pollInterval = 10000; // Interval for polling Registry registry.
//var stopPolling = false;

/**
 * A dynamic config processor for managing LTM pools.
 * Note that the pool member name is not visible in the GUI. It is generated by MCP according to a pattern, we don't want
 * the user setting it
 *
 * @constructor
 */
function msraeurekaConfigProcessor() {
}

msraeurekaConfigProcessor.prototype.setModuleDependencies = function (options) {
    logger.info("setModuleDependencies called");
    configTaskUtil = options.configTaskUtil;
};

msraeurekaConfigProcessor.prototype.WORKER_URI_PATH = "shared/iapp/processors/msraeurekaConfig";

msraeurekaConfigProcessor.prototype.onStart = function (success) {
    logger.fine("MSRA: OnStart, msraeurekaConfigProcessor.prototype.onStart");
    this.apiStatus = this.API_STATUS.INTERNAL_ONLY;
    this.isPublic = true;

    configTaskUtil.initialize({
        restOperationFactory: this.restOperationFactory,
        eventChannel: this.eventChannel,
        restHelper: this.restHelper
    });

    success();
};


/**
 * Handles initial configuration or changed configuration. Sets the block to 'BOUND' on success
 * or 'ERROR' on failure. The routine is resilient in that it will try its best and always go
 * for the 'replace' all attitude.
 *
 * @param restOperation - originating rest operation that triggered this processor
 */
msraeurekaConfigProcessor.prototype.onPost = function (restOperation) {
    var configTaskState,
        blockState,
        oThis = this;
    logger.fine("MSRA: onPost, msraeurekaConfigProcessor.prototype.onPost");

    var inputProperties;
    var dataProperties;
    try {
        configTaskState = configTaskUtil.getAndValidateConfigTaskState(restOperation);
        blockState = configTaskState.block;
        logger.fine("MSRA: onPost, inputProperties ", blockState.inputProperties);
        logger.fine("MSRA: onPost, dataProperties ", blockState.dataProperties);
        inputProperties = blockUtil.getMapFromPropertiesAndValidate(
            blockState.inputProperties,
            ["eurekaEndpoint", "servicePath", "app", "hostName", "ipAddr", "port", "statusPageUrl", "vipAddress", "dataCenterInfo"]
        );
        dataProperties = blockUtil.getMapFromPropertiesAndValidate(
            blockState.dataProperties,
            ["pollInterval"]
        );

    } catch (ex) {
        restOperation.fail(ex);
        return;
    }

    // Mark that the request meets all validity checks and tell the originator it was accepted.
    this.completeRequest(restOperation, this.wellKnownPorts.STATUS_ACCEPTED);

    // Generic URI components, minus the 'path'
    var uri = this.restHelper.buildUri({
        protocol: this.wellKnownPorts.DEFAULT_HTTP_SCHEME,
        port: this.wellKnownPorts.DEFAULT_JAVA_SERVER_PORT,
        hostname : "localhost"
    });

    //Accept input proterties, set the status to BOUND.

    const inputEndPoint = inputProperties.eurekaEndpoint.value;
    const inputServicePath = inputProperties.servicePath.value;
    const inputApp = inputProperties.app.value;
    const inputHostName = inputProperties.hostName.value;
    const inputIpAddr = inputProperties.ipAddr.value;
    const inputPort = inputProperties.port.value;
    const inputStatusPageUrl = inputProperties.statusPageUrl.value;
    const inputVipAddrss = inputProperties.vipAddress.value;
    const inputDataCenterName = inputProperties.dataCenterInfo.value;
    var pollInterval = dataProperties.pollInterval.value * 1000;

    const serviceID = inputProperties.ipAddr.value + ":" + inputProperties.port.value; // For polling signal and audit.

    // Set the polling interval
    if (pollInterval) {
        if (pollInterval < 10000) {
            logger.fine("MSRA: onPost, pollInternal is too short, will set it to 10s ", pollInterval);
            pollInterval = 10000;
        }
    } else {
        logger.fine("MSRA: onPost, pollInternal is not set, will set it to 30s ", pollInterval);
        pollInterval = 30000;
    }
    
    // Setup the polling signal for audit
    if (global.msraeurekaOnPolling.includes(serviceID)) {
        return logger.fine("msra: onPost, already has an instance polling the same serviceID, please check it out: " + serviceID);
    } else { 
        global.msraeurekaOnPolling.push(serviceID);
        logger.fine("msra onPost: set msraeurekaOnpolling signal: ", global.msraeurekaOnPolling);
    }


    logger.fine(
      "MSRA: onPost, Input properties accepted, change to BOUND status, start to poll Registry for: " +
        serviceID
    );

    //stopPolling = false;

    configTaskUtil.sendPatchToBoundState(configTaskState, 
            oThis.getUri().href, restOperation.getBasicAuthorization());

    // A internal service to register application to eureka server.
       
    logger.fine("MSRA: onPost, registry endpoints: " + inputEndPoint);

    // Prepare the instance body
    const instanceBody = {
        "instance":{
            "app":inputApp,
            "hostName":inputHostName,
            "ipAddr":inputIpAddr,
            "statusPageUrl":inputStatusPageUrl,
            "port":{
                "$":inputPort,
                "@enabled":"true"
            },
            "vipAddress":inputVipAddrss,
            "dataCenterInfo":{
                "@Class":"com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo",
                "name":inputDataCenterName
            },
            "status":"UP"
        }
    };

    //deregister a instance
    function deregisterInstance (instance) {
        // deregister an instance from eureka
        fetch(instance, { method: 'DELETE'})
            .then(function (res) {
                if (res.ok) { // res.status >= 200 && res.status < 300
                    logger.fine("MSRA: onPost, Deregister the instance: "+ inputHostName, res.statusText);
                } else {
                    logger.fine("MSRA: onPost, Failed to deregister the instance: "+ inputHostName, res.statusText);
                }
            })
            .catch(err => console.error(err));
    }


    // connect to eureka registry to retrieve end points.
    const absoluteUrl = inputEndPoint + inputServicePath + inputApp;
    const instanceUrl = inputEndPoint + inputServicePath + inputApp + "/" + inputHostName;

    (function schedule() {
        var pollRegistry = setTimeout(function () {
            fetch(absoluteUrl, { headers: {'Accept': 'application/json'} })
                .then(res => res.json())
                .then(function(jsondata) {
                    //let nodeAddress = []; // don't care the nodeAddress anymore.
                    if (jsondata.message === 'Not Found') {
                        logger.fine("MSRA: onPost, Service not found, will check the status of vs, then decide register into eureka server or not.");

                        // check the status of the vs in F5

                        // Use tmsh to check vs status of BIG-IP application instead of restful API

                        // Start with check the exisitence of the given pool
                        mytmsh.executeCommand("tmsh -a show ltm virtual " + inputApp +' field-fmt').then(function (res) {
                            logger.fine("MSRA: onPost, Found the virtual server in F5, will check the availability: " + inputApp);
                            if (res.indexOf('status.availability-state available') >= 0) {
                                logger.fine("MSRA: onPost, the virtual server in F5 is available, will register it to eureka server: " + inputApp);
                                // register an instance to eureka
                                const registerUrl = inputEndPoint + inputServicePath + inputApp;
                                fetch(registerUrl, {
                                        method: 'POST',
                                        body:    JSON.stringify(instanceBody),
                                        headers: { 'Content-Type': 'application/json' }
                                    })
                                    .then(function (res) {
                                        if (res.ok) { // res.status >= 200 && res.status < 300
                                            logger.fine("MSRA: onPost, Registered the instance: "+ inputHostName, res.statusText);
                                        } else {
                                            logger.fine("MSRA: onPost, Failed to register the instance: "+ inputHostName, res.statusText);
                                        }
                                    })
                                    .catch(err => logger.fine("MSRA: onPost, failed to register into eureka: ",err.message));
                            } 
                        })
                            // Error handling
                            .catch(function (error) {
                                if (error.message.indexOf('was not found') >= 0) {
                                    logger.fine("MSRA: onPost, virtual server not found: " + inputApp);
                                    return;
                                }
                                logger.fine("MSRA: onPost, Fail to check status of the virtual server: " + error.message);
                                return;
                            });
                    } else {
                        // Assume only 1 instance for each service for now, can be extended to multiple instances later.
                        // do health check for BIG-IP application, deregister if app down
                        // Use tmsh to check vs status of BIG-IP application instead of restful API
                        // Start with check the exisitence of the given pool
                        mytmsh.executeCommand("tmsh -a show ltm virtual " + inputApp +' field-fmt').then(function (res) {
                            logger.fine("MSRA: onPost, Found the virtual server in F5, will check the availability: " + inputApp);
                            if (res.indexOf('status.availability-state available') >= 0) {
                                logger.fine("MSRA: onPost, the virtual server in F5 is available, will send heartbeat to eureka server: " + inputApp);

                                // send a heartbeat to eureka
                                fetch(instanceUrl, { method: 'PUT'})
                                    .then(function (res) {
                                        if (res.ok) { // res.status >= 200 && res.status < 300
                                            logger.fine("MSRA: onPost, Sent heartbeat to the instance: " + inputHostName, res.statusText);
                                        } else {
                                            logger.fine("MSRA: onPost, Failed to sent heartbeat to the instance: "+ inputHostName, res.statusText);
                                        }
                                    })
                                    .catch(err => console.error(err));
                            } else {
                                logger.fine("MSRA: onPost, he virtual server is not available, will deregister from eureka server: " + inputApp);
                                // deregister an instance from eureka
                                deregisterInstance (instanceUrl);
                            }
                        })
                            // Error handling
                            .catch(function (error) {
                                if (error.message.indexOf('was not found') >= 0) {
                                    logger.fine("MSRA: onPost, virtual server not found, will deregister from eureka server: " + inputApp);

                                    // deregister an instance from eureka
                                    deregisterInstance (instanceUrl);
                                    return;
                                }
                                logger.fine("MSRA: onPost, Fail to check status of the virtual server: " + error.message);
                                return;
                            });
                    }
                }, function (err) {
                    logger.fine("MSRA: onPost, Fail to retrieve eureka app due to: ", err.message);
                }).catch(function (error) {
                    logger.fine("MSRA: onPost, Fail to retrieve euraka app due to: ", error.message);
                });
            schedule();
        }, pollInterval);

        // Stop polling while undepllyment, and deregister the app from eureka server
        if (global.msraeurekaOnPolling.includes(serviceID)) {
          logger.fine("msra: onPost, keep polling registry for: " + serviceID);
        } else {
          process.nextTick(() => {
            clearTimeout(pollRegistry);
            logger.fine("MSRA: onPost/stopping, Stop polling registry for: " + serviceID);
          });
          // deregister the app from eureka server
          setTimeout(function () {
            // deregister an instance from eureka
            deregisterInstance(instanceUrl);
          }, 2000);
        }
    })();
};


/**
 * Handles DELETE. The configuration must be removed, if it exists. Patch the block to 'UNBOUND' or 'ERROR'
 *
 * @param restOperation - originating rest operation that triggered this processor
 */
msraeurekaConfigProcessor.prototype.onDelete = function (restOperation) {
  var configTaskState, blockState;
  var oThis = this;

  logger.fine("MSRA: onDelete, msraeurekaConfigProcessor.prototype.onDelete");

  var inputProperties;
  try {
    configTaskState =
      configTaskUtil.getAndValidateConfigTaskState(restOperation);
    blockState = configTaskState.block;
    inputProperties = blockUtil.getMapFromPropertiesAndValidate(
      blockState.inputProperties,
      ["eurekaEndpoint", "servicePath", "app", "ipAddr", "port"]
    );
  } catch (ex) {
    restOperation.fail(ex);
    return;
  }
  this.completeRequest(restOperation, this.wellKnownPorts.STATUS_ACCEPTED);

  // Generic URI components, minus the 'path'
  var uri = this.restHelper.buildUri({
    protocol: this.wellKnownPorts.DEFAULT_HTTP_SCHEME,
    port: this.wellKnownPorts.DEFAULT_JAVA_SERVER_PORT,
    hostname: "localhost",
  });

  // In case user requested configuration to deployed to remote
  // device, setup remote hostname, HTTPS port and device group name
  // to be used for identified requests

  //Accept input proterties, set the status to BOUND.

  const inputEndPoint = inputProperties.eurekaEndpoint.value;
  const inputEndPointTail = inputEndPoint.toString().split(":")[1];
  const inputEndPointAddr = inputEndPointTail.toString().slice(2);
  const inputEndPointPort = inputEndPoint.toString().split(":")[2];
  const inputServicePath = inputProperties.servicePath.value;
  const inputApp = inputProperties.app.value;

  const serviceID =
    inputProperties.ipAddr.value + ":" + inputProperties.port.value; // For polling signal and audit.

  //inputEndPoint = inputEndPoint.toString().split(",");
  logger.fine("MSRA: onDelete, registry endpoints: " + inputEndPoint);

  // connect to eureka registry to retrieve end points.
  const absoluteUrl = inputEndPoint + inputServicePath + inputApp;

  // check the eureka server for the application

  fetch(absoluteUrl, { headers: { Accept: "application/json" } })
    .then((res) => res.json())
    .then(
      function (jsondata) {
        //let nodeAddress = []; // don't care the nodeAddress anymore.
        if (jsondata.message === "Not Found") {
          logger.fine(
            "MSRA: onDelete, App is not found in eureka server, will do nothing."
          );
        } else {
          logger.fine(
            "MSRA: onDelete, App  found in eureka server, will deregister it."
          );
          // do deregister in onPost loop ...
        }
      },
      function (err) {
        logger.fine(
          "MSRA: onDelete, Fail to retrieve eureka app due to: ",
          err.message
        );
      }
    )
    .catch(function (error) {
      logger.fine(
        "MSRA: onDelete, Fail to retrieve euraka app due to: ",
        error.message
      );
    });

  // change the state to UNBOUND

  configTaskUtil.sendPatchToUnBoundState(
    configTaskState,
    oThis.getUri().href,
    restOperation.getBasicAuthorization()
  );

  // Stop polling registry while undeploy ??
  // Delete the polling signal
  let signalIndex = global.msraeurekaOnPolling.indexOf(serviceID);
  global.msraeurekaOnPolling.splice(signalIndex, 1);
  //stopPollingEvent.emit('stopPollingRegistry');
  logger.fine("MSRA: onDelete, Stop polling Registry while ondelete action.");
};

module.exports = msraeurekaConfigProcessor;
