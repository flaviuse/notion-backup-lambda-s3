# Notion backup - serverless function with AWS lambda & AWS S3 
This project allow you to automate the backup of your Notion space.

![Notion-backup-flowchart](https://user-images.githubusercontent.com/40322270/96321283-25d4e900-1015-11eb-953f-cea61c61eb8c.png)
## Pre-requisite
Requires an S3 bucket and AWS lambda function.
## Setup
To deploy the lambda function use ```serverless deploy```.
On AWS create a S3 bucket to store the Notion Exports.

Setup the environmental variables on the AWS lambda console.
- TOKEN: Your authentication token, token_v2 in your cookies of notion.so.
- SPACE_ID: The id of your notion space, you can find it in the requests of the network tab.
- EXPORT_TYPE: put "markdown", it is possible to export to html and pdf (enterprise) as well but markdown is the best.
- BUCKET_NAME: the name of the bucket where you want to store the exports.
- ACCESS_KEY_ID: Access key id of IAM user for the bucket access.
- SECRET_ACCESS_KEY: Secret Access key of IAM user for the bucket access.
- SENDGRID_API_KEY: API Key for sendgrid (email service).
- EMAIL: The email you want to send the message everyday.
