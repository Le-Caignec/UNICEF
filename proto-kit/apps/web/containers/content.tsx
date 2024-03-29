import React from "react";
import { Typography, Card } from "@mui/material";
import MultiStepForm from "./multiStepForm";
import WarningIcon from "@mui/icons-material/Warning";

const WarningBox = ({ message }: { message: string }) => {
  return (
    <Card
      sx={{
        maxWidth: 350,
        margin: "auto",
        marginTop: 4,
        backgroundColor: "rgba(255, 204, 203, 0.35)",
        display: "flex",
        alignItems: "center",
      }}
    >
      <WarningIcon color="error" sx={{ fontSize: 35, m: 2 }} />
      <Typography
        variant="h6"
        align="left"
        color="error"
        sx={{ fontSize: 15, m: 2 }}
      >
        {message}
      </Typography>
    </Card>
  );
};

export default function Content() {
  return (
    <div>
      <WarningBox
        message={"Please be sure to create your Auro wallet before signing"}
      />
      <MultiStepForm />
    </div>
  );
}
