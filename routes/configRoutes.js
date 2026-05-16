const express = require("express");

const router = express.Router();

const Config = require("../models/Config");

const verifyToken =
    require("../middlewares/verifyToken");

const isAdmin =
    require("../middlewares/isAdmin");


router.get("/apiComentarios", verifyToken, async (req, res) => {
  try {

    const config = await Config.findOne();

    if (!config) {
      return res.json(null);
    }

    const apiComentarios = config.apiComentarios.find(
      item => item.key === "apiComentarios"
    );

    res.json(apiComentarios || null);

  } catch (error) {
    res.status(500).json(error);
  }
});

router.put("/apiComentarios", verifyToken, isAdmin, async (req, res) => {
  try {

    const { value, tipo } = req.body;

    const config = await Config.findOne();

    if (!config) {
      const newConfig = await Config.create({
        apiComentarios: [
          {
            key: "apiComentarios",
            value,
            tipo
          }
        ]
      });

      return res.json(newConfig);
    }

    const index = config.apiComentarios.findIndex(
      item => item.key === "apiComentarios"
    );

    if (index >= 0) {
      config.apiComentarios[index].value = value;
      config.apiComentarios[index].tipo = tipo;
    } else {
      config.apiComentarios.push({
        key: "apiComentarios",
        value,
        tipo
      });
    }

    await config.save();

    res.json(config);

  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: "Error en config",
      error: error.message
    });
  }
});

module.exports=router;