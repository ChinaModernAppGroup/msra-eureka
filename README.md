# iAppLX MSRA for eureka

This iApp is an example of MSRA for eureka, including an audit processor.  

## Build (requires rpmbuild)

    $ npm run build

Build output is an RPM package
## Using IAppLX from BIG-IP UI
If you are using BIG-IP, install f5-iapplx-msra-eureka RPM package using iApps->Package Management LX->Import screen. To create an application, use iApps-> Templates LX -> Application Services -> Applications LX -> Create screen. Default IApp LX UI will be rendered based on the input properties specified in basic pool IAppLX.

## Using IAppLX from Container to configure BIG-IP [coming soon]

Using the REST API to work with BIG-IP with f5-iapplx-msra-eureka IAppLX package installed. 

Create an Application LX block with all inputProperties as shown below.
Save the JSON to block.json and use it in the curl call. Refer to the clouddoc link for more detail: https://clouddocs.f5.com/products/iapp/iapp-lx/tmos-14_0/iapplx_ops_tutorials/creating_iappslx_with_rest.html .

```json
{
  "name": "msraeureka",
  "inputProperties": [
    {
      "id": "eurekaEndpoint",
      "type": "STRING",
      "value": "http://1.1.1.1:8761",
      "metaData": {
        "description": "eureka endpoint address, put authentication in the endpoint, eg. http://user:pass@1.1.1.1:8761",
        "displayName": "eureka endpoints",
        "isRequired": true
      }
    },
    {
      "id": "servicePath",
      "type": "STRING",
      "value": "/eureka/apps/",
      "metaData": {
        "description": "Service path of your eureka server",
        "displayName": "Service path in registry",
        "isRequired": true
      }
    },
    {
      "id": "app",
      "type": "STRING",
      "value": "msra-service166-onf5",
      "metaData": {
        "description": "Application name to be registered",
        "displayName": "Application Name",
        "isRequired": true
      }
    },
    {
      "id": "hostName",
      "type": "STRING",
      "value": "bigipvs166",
      "metaData": {
        "description": "Host Name to be registered",
        "displayName": "Host Name",
        "isRequired": true
      }
    },
    {
      "id": "ipAddr",
      "type": "STRING",
      "value": "10.1.10.166",
      "metaData": {
        "description": "IP address to be registered",
        "displayName": "IP address",
        "isRequired": true
      }
    },
    {
      "id": "port",
      "type": "NUMBER",
      "value": 8080,
      "metaData": {
        "description": "port to be registered",
        "displayName": "Port",
        "isRequired": true
      }
    },
    {
      "id": "statusPageUrl",
      "type": "STRING",
      "value": "http://localhost:8080",
      "metaData": {
        "description": "Status page URL",
        "displayName": "Status Page",
        "isRequired": true
      }
    },
    {
      "id": "vipAddress",
      "type": "STRING",
      "value": "10.1.10.166",
      "metaData": {
        "description": "VIP address to be registered",
        "displayName": "VIP address",
        "isRequired": true
      }
    },
    {
      "id": "dataCenterInfo",
      "type": "STRING",
      "value": "MyOwn",
      "metaData": {
        "description": "Datacenter Information",
        "displayName": "Datacenter Information",
        "isRequired": true
      }
    }
  ],
  "dataProperties": [
    {
      "id": "pollInterval",
      "type": "NUMBER",
      "value": 30,
      "metaData": {
        "description": "Interval of polling VIP status, 30s by default.",
        "displayName": "Polling Invertal",
        "isRequired": false
      }
    }
  ],
  "configurationProcessorReference": {
    "link": "https://localhost/mgmt/shared/iapp/processors/msraeurekaConfig"
  },
  "auditProcessorReference": {
    "link": "https://localhost/mgmt/shared/iapp/processors/msraeurekaEnforceConfiguredAudit"
  },
  "audit": {
    "intervalSeconds": 60,
    "policy": "ENFORCE_CONFIGURED"
  },
  "configProcessorTimeoutSeconds": 30,
  "statsProcessorTimeoutSeconds": 15,
  "configProcessorAffinity": {
    "processorPolicy": "LOAD_BALANCED",
    "affinityProcessorReference": {
      "link": "https://localhost/mgmt/shared/iapp/processors/affinity/load-balanced"
    }
  },
  "state": "TEMPLATE"
}
```

Post the block through REST API using curl. 
```bash
curl -sk -X POST -d @block.json https://bigip_mgmt_ip:8443/mgmt/shared/iapp/blocks
```
