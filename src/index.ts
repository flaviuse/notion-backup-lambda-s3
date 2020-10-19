import { PassThrough } from "stream";
import { S3 } from "aws-sdk";
import fetch from "node-fetch";
import * as SendGrid from "@sendgrid/mail";

exports.handler = async () => {
  //? Verify all environment variables
  if (!process.env.SPACE_ID) {
    throw new Error("Unexpected error: Missing SPACE_ID");
  }
  const SPACE_ID: string = process.env.SPACE_ID;

  if (!process.env.BUCKET_NAME) {
    throw new Error("Unexpected error: Missing BUCKET_NAME");
  }
  const BUCKET_NAME: string = process.env.BUCKET_NAME;

  if (!process.env.EXPORT_TYPE) {
    throw new Error("Unexpected error: Missing EXPORT_TYPE");
  }
  const EXPORT_TYPE: string = process.env.EXPORT_TYPE;

  if (!process.env.TOKEN) {
    throw new Error("Unexpected error: Missing EXPORT_TYPE");
  }
  const TOKEN: string = process.env.TOKEN;

  if (!process.env.EMAIL) {
    throw new Error("Unexpected error: Missing EMAIL");
  }
  const EMAIL: string = process.env.EMAIL;

  if (!process.env.SENDGRID_API_KEY) {
    throw new Error("Unexpected error: Missing SENDGRID_API_KEY");
  }
  const SENDGRID_API_KEY: string = process.env.SENDGRID_API_KEY;

  if (!process.env.SECRET_ACCESS_KEY) {
    throw new Error("Unexpected error: Missing SECRET_ACCESS_KEY");
  }
  const SECRET_ACCESS_KEY: string = process.env.SECRET_ACCESS_KEY;

  if (!process.env.ACCESS_KEY_ID) {
    throw new Error("Unexpected error: Missing ACCESS_KEY_ID");
  }
  const ACCESS_KEY_ID: string = process.env.ACCESS_KEY_ID;

  const s3 = new S3({
    region: "eu-west-3",
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    },
  });

  async function generateSpaceExport() {
    console.log(`Starting export in ${EXPORT_TYPE}. SpaceId: ${SPACE_ID.slice(0, 6)}...`);

    const task = {
      task: {
        eventName: "exportSpace",
        request: {
          spaceId: SPACE_ID,
          exportOptions: {
            exportType: EXPORT_TYPE,
            timeZone: "Europe/Paris",
            locale: "en",
          },
        },
      },
    };

    const spaceExportTask = await fetch("https://www.notion.so/api/v3/enqueueTask", {
      headers: {
        Cookie: `token_v2=${TOKEN};`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(task),
      method: "POST",
    });

    return spaceExportTask;
  }

  async function getSpaceExportUrl(): Promise<string> {
    const spaceExportTask = await generateSpaceExport();
    const { taskId } = await spaceExportTask.json();

    console.log(`Waiting for export. Task: ${taskId.slice(0, 6)}...`);

    const spaceExportURL: string = await new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        const res = await fetch("https://www.notion.so/api/v3/getTasks", {
          headers: {
            Cookie: `token_v2=${TOKEN};`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ taskIds: [taskId] }),
          method: "POST",
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

  function printProgressMessage(evt: S3.ManagedUpload.Progress) {
    console.log(
      `Upload: ${evt.total ? ` ${((evt.loaded * 100) / evt.total).toString()} %` : "..."}`
    );
  }

  async function uploadBackupToS3(spaceExportUrl: string) {
    const responseStream = await fetch(spaceExportUrl);

    const passThrough = new PassThrough();

    const uploadPromise: Promise<S3.ManagedUpload.SendData> = s3
      .upload({
        Bucket: BUCKET_NAME,
        Key: new Date().toISOString().split("T")[0] + "-notion-space-export.zip",
        Body: passThrough,
        ContentType: responseStream.headers.get("content-type") || "",
        ContentLength: parseInt(responseStream.headers.get("content-length") || ""),
      })
      .on("httpUploadProgress", function (evt: S3.ManagedUpload.Progress) {
        printProgressMessage(evt);
      })
      .promise();

    responseStream.body.pipe(passThrough);

    return uploadPromise
      .then((res) => {
        console.log("Upload completed");
        return res.Key;
      })
      .catch((err: ErrorEvent) => {
        throw err;
      });
  }

  async function sendNotificationMail(preSignedUrl: string | undefined) {
    SendGrid.setApiKey(SENDGRID_API_KEY);

    const mail: SendGrid.MailDataRequired = {
      to: EMAIL,
      from: `notion@mybackup.com`,
      subject: "Your notion backup is ready !",
      text: "Back up notion",
      html: `<p>Your backup is available at:\n\n
  <a href="${preSignedUrl}">${preSignedUrl}</a></p>`,
    };

    return SendGrid.send(mail)
      .then(() => {
        console.log("Email sent");
      })
      .catch((err: ErrorEvent) => console.log("Email error:", err));
  }

  async function createPreSignedUrl(Key: string) {
    const params = {
      Bucket: BUCKET_NAME,
      Key,
      Expires: 60 * 60 * 24,
    };
    try {
      const PreSignedUrl = await new Promise<string>((resolve, reject) => {
        s3.getSignedUrl("getObject", params, (err, url) => {
          err ? reject(err) : resolve(url);
        });
      });
      return PreSignedUrl;
    } catch (err) {
      if (err) {
        console.log(err);
      }
    }
  }

  async function main() {
    const exportS3Url = await getSpaceExportUrl();
    const objectKey = await uploadBackupToS3(exportS3Url);
    const preSignedUrl = await createPreSignedUrl(objectKey);
    await sendNotificationMail(preSignedUrl);
    console.log(`Lambda function execution ended. File available at ${preSignedUrl}`);
  }

  await main();
};
