const stream = require("stream");
const AWS = require("aws-sdk");
const fetch = require("node-fetch");
const sgMail = require("@sendgrid/mail");

exports.handler = async (event, context, callback) => {
  async function generateSpaceExport() {
    console.log(
      `Starting export in ${process.env.EXPORT_TYPE}. SpaceId: ${process.env.SPACE_ID.slice(
        0,
        6
      )}...`
    );

    const task = {
      task: {
        eventName: "exportSpace",
        request: {
          spaceId: process.env.SPACE_ID,
          exportOptions: {
            exportType: process.env.EXPORT_TYPE,
            timeZone: "Europe/Paris",
            locale: "en",
          },
        },
      },
    };

    const spaceExportTask = await fetch("https://www.notion.so/api/v3/enqueueTask", {
      credentials: "include",
      headers: {
        Cookie: `token_v2=${process.env.TOKEN};`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(task),
      method: "POST",
      mode: "cors",
    });

    return spaceExportTask;
  }

  async function getSpaceExportUrl() {
    const spaceExportTask = await generateSpaceExport();
    const { taskId } = await spaceExportTask.json();

    console.log(`Waiting for export. Task: ${taskId.slice(0, 6)}...`);

    const spaceExportURL = await new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        const res = await fetch("https://www.notion.so/api/v3/getTasks", {
          credentials: "include",
          headers: {
            Cookie: `token_v2=${process.env.TOKEN};`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ taskIds: [taskId] }),
          method: "POST",
          mode: "cors",
        });

        const json = await res.json();
        const exportStatus = json.results[0].status;

        if (!exportStatus) {
          clearInterval(interval);
          reject(new Error(JSON.stringify(json)));
          console.log(JSON.stringify(json));
        } else if (exportStatus.type == "progress") {
          console.log(`${exportStatus.pagesExported} pages exported`);
        } else if (exportStatus.type == "complete") {
          clearInterval(interval);
          console.log("Export done");
          resolve(exportStatus.exportURL);
        }
      }, 5000);
    });
    return spaceExportURL;
  }

  function printProgressMessage(evt) {
    console.log(`Upload: ${evt.total ? ` ${parseInt((evt.loaded * 100) / evt.total)} %` : "..."}`);
  }

  async function uploadBackupToS3(spaceExportUrl) {
    const s3 = new AWS.S3({
      region: "eu-west-3",
      credentials: {
        accessKeyId: process.env.ACCESS_KEY_ID,
        secretAccessKey: process.env.SECRET_ACCESS_KEY,
      },
    });

    const responseStream = await fetch(spaceExportUrl);

    const passThrough = new stream.PassThrough();

    const uploadPromise = s3
      .upload({
        Bucket: process.env.BUCKET_NAME,
        Key: new Date().toISOString().split("T")[0] + "-notion-space-export.zip",
        Body: passThrough,
        ContentType: responseStream.headers["content-type"],
        ContentLength: responseStream.headers["content-length"],
      })
      .on("httpUploadProgress", function (evt) {
        printProgressMessage(evt);
      })
      .promise();

    responseStream.body.pipe(passThrough);

    return uploadPromise
      .then((res) => {
        console.log("Upload completed");
        return res.Location;
      })
      .catch((err) => {
        throw err;
      });
  }

  async function sendNotificationMail(backupUrl) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const mail = {
      to: process.env.EMAIL,
      from: `notion@mybackup.com`,
      subject: "Your notion backup is ready !",
      text: "Back up notion",
      html: `<p>Your backup is available at:\n\n
  <a href="${backupUrl}">${backupUrl}</a></p>`,
    };

    return sgMail
      .send(mail)
      .then(() => {
        console.log("Email sent");
      })
      .catch((err) => console.log("Email error:", err));
  }

  async function main() {
    const exportS3Url = await getSpaceExportUrl();
    const backupUrl = await uploadBackupToS3(exportS3Url);
    await sendNotificationMail(backupUrl);
    console.log(`Lambda function execution ended. File available at ${backupUrl}`);
  }

  await main();
};
